import { Injectable, Logger } from '@nestjs/common';
import {
  ServerSettingsResponse,
  StorageStatusResponse,
  StorageTestResponse,
} from 'picsur-shared/dist/dto/api/server.dto';
import {
  SecretServerSettings,
  ServerSetting,
  ServerSettingEnvName,
  ServerSettingList,
  ServerSettingValidators,
  StorageSettings,
} from 'picsur-shared/dist/dto/server-settings.dto';
import {
  AsyncFailable,
  Fail,
  FT,
  HasFailed,
} from 'picsur-shared/dist/types/failable';
import { ImageStorageMaintenanceService } from '../../collections/image-db/image-storage-maintenance.service.js';
import { TestS3Storage } from '../../collections/object-storage/object-storage.service.js';
import { ServerSettingsDbService } from '../../collections/server-settings-db/server-settings-db.service.js';
import {
  BuildStorageConfig,
  SameStorageLocation,
  StorageConfig,
  StorageConfigService,
  StorageDriver,
} from '../../config/early/storage.config.service.js';
import {
  EnvServerSetting,
  RunningStoredServerSettings,
  ServerSettingDefault,
  ServerSettingResolver,
  StoredServerSettings,
} from '../../config/server-settings.js';
import { RequestRestart, RestartError, StartedAt } from '../../util/restart.js';
import { StorageMigrationService } from './storage-migration.service.js';

interface PlannedChange {
  changes: Map<ServerSetting, string | null>;
  stored: StoredServerSettings;
  storage: StorageConfig;
}

// The server settings as the settings page shows and changes them
@Injectable()
export class ServerSettingsService {
  private readonly logger = new Logger(ServerSettingsService.name);

  constructor(
    private readonly settingsDb: ServerSettingsDbService,
    private readonly maintenance: ImageStorageMaintenanceService,
    private readonly migration: StorageMigrationService,
    private readonly storageConfig: StorageConfigService,
  ) {}

  async describe(): AsyncFailable<ServerSettingsResponse> {
    const stored = await this.settingsDb.getAll();
    if (HasFailed(stored)) return stored;
    return this.describeStored(stored);
  }

  // Stores the given settings, which take effect when Picsur restarts. A
  // value of null goes back to the default.
  async update(
    values: Record<string, string | null>,
  ): AsyncFailable<ServerSettingsResponse> {
    const plan = await this.plan(values);
    if (HasFailed(plan)) return plan;
    if (plan.changes.size === 0) return this.describeStored(plan.stored);

    // Keep what is stored where it can be found
    const locationChanged = !SameStorageLocation(
      this.runningStorage().s3,
      plan.storage.s3,
    );
    if (locationChanged) {
      const kept = await this.checkBucketIsEmpty();
      if (HasFailed(kept)) return kept;
    }

    // Only a bucket that works is stored, so Picsur can start with it. It is
    // not needed for switching back to the database, and moving images there.
    const changed = [...plan.changes.keys()];
    const bucketChanged = changed.some(
      (key) =>
        StorageSettings.includes(key) && key !== ServerSetting.StorageDriver,
    );
    const toBucket =
      changed.includes(ServerSetting.StorageDriver) &&
      plan.storage.driver === StorageDriver.S3;
    if (plan.storage.s3 !== null && (bucketChanged || toBucket)) {
      const tested = await TestS3Storage(plan.storage.s3);
      if (HasFailed(tested)) return tested;
    }

    const updated = await this.settingsDb.update(plan.changes);
    if (HasFailed(updated)) return updated;
    this.logger.log(
      `Changed server settings: ${[...plan.changes.keys()].join(', ')}`,
    );

    // Cached conversions in the old bucket would not be found anymore, they
    // are made again when needed
    if (locationChanged) {
      const dropped = await this.maintenance.dropObjectStorageDerivatives();
      if (HasFailed(dropped)) dropped.print(this.logger);
    }

    return this.describeStored(plan.stored);
  }

  // Tries out the storage the given changes would result in
  async testStorage(
    values: Record<string, string | null>,
  ): AsyncFailable<StorageTestResponse> {
    const plan = await this.plan(values);
    if (HasFailed(plan)) return plan;

    const s3 = plan.storage.s3;
    if (s3 === null) {
      return Fail(FT.BadRequest, 'There is no bucket to test');
    }
    const tested = await TestS3Storage(s3);
    if (HasFailed(tested)) return tested;
    return { bucket: s3.bucket, created: tested.created };
  }

  async restart(): AsyncFailable<Date> {
    if (this.migration.isRunning) {
      return Fail(
        FT.Conflict,
        'Images are being moved to other storage, stop that or wait until it is done first',
      );
    }

    // Images might have been stored in the bucket since it was changed
    const stored = await this.settingsDb.getAll();
    if (HasFailed(stored)) return stored;
    const next = BuildStorageConfig(ServerSettingResolver(stored));
    if (!SameStorageLocation(this.runningStorage().s3, next.s3)) {
      const kept = await this.checkBucketIsEmpty();
      if (HasFailed(kept)) return kept;
    }

    const requested = RequestRestart();
    if (HasFailed(requested)) return requested;
    this.logger.log('Restarting, as asked on the settings page');
    return StartedAt();
  }

  async storageStatus(): AsyncFailable<StorageStatusResponse> {
    try {
      const status = await this.maintenance.status();
      return {
        driver: this.storageConfig.getDriver(),
        bucket: this.storageConfig.getS3Config()?.bucket ?? null,
        files: {
          database: status.files.database,
          object_storage: status.files.objectStorage,
        },
        derivatives: {
          database: status.derivatives.database,
          object_storage: status.derivatives.objectStorage,
        },
        migration: this.migration.getState(),
      };
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  // Works out what the given changes result in, and whether they are valid
  private async plan(
    values: Record<string, string | null>,
  ): AsyncFailable<PlannedChange> {
    const current = await this.settingsDb.getAll();
    if (HasFailed(current)) return current;

    const changes = new Map<ServerSetting, string | null>();
    for (const [key, raw] of Object.entries(values)) {
      if (!ServerSettingList.includes(key as ServerSetting)) {
        return Fail(FT.UsrValidation, `Unknown setting "${key}"`);
      }
      const setting = key as ServerSetting;
      const value = raw === null || raw.trim() === '' ? null : raw.trim();

      const fromEnv = EnvServerSetting(setting);
      if (fromEnv !== undefined) {
        // Sending back what the page shows is fine
        if (value === fromEnv) continue;
        return Fail(
          FT.UsrValidation,
          `${ServerSettingEnvName(setting)} is set in the environment, so it can only be changed there`,
        );
      }

      if (value !== null) {
        const valid = ServerSettingValidators[setting].safeParse(value);
        if (!valid.success) {
          return Fail(
            FT.UsrValidation,
            `${ServerSettingEnvName(setting)}: ${valid.error.issues[0]?.message ?? 'Invalid value'}`,
          );
        }
      }

      if ((current.get(setting) ?? null) !== value) changes.set(setting, value);
    }

    const stored = new Map(current);
    for (const [key, value] of changes) {
      if (value === null) stored.delete(key);
      else stored.set(key, value);
    }

    let storage: StorageConfig;
    try {
      storage = BuildStorageConfig(ServerSettingResolver(stored));
    } catch (e) {
      return Fail(FT.UsrValidation, e instanceof Error ? e.message : e);
    }

    return { changes, stored, storage };
  }

  private describeStored(stored: StoredServerSettings): ServerSettingsResponse {
    const running = RunningStoredServerSettings();

    return {
      settings: ServerSettingList.map((key) => {
        const fromEnv = EnvServerSetting(key);
        const value = fromEnv ?? stored.get(key);
        return {
          key,
          value:
            value === undefined || SecretServerSettings.includes(key)
              ? null
              : value,
          set: value !== undefined,
          default: ServerSettingDefault(key),
          source:
            fromEnv !== undefined
              ? 'environment'
              : stored.has(key)
                ? 'settings'
                : 'default',
          env: ServerSettingEnvName(key),
        };
      }),
      // Settings from the environment are the same either way
      restart_needed: ServerSettingList.some(
        (key) =>
          EnvServerSetting(key) === undefined &&
          stored.get(key) !== running.get(key),
      ),
      restart_error: RestartError(),
      started_at: StartedAt(),
    };
  }

  private runningStorage(): StorageConfig {
    return BuildStorageConfig(
      ServerSettingResolver(RunningStoredServerSettings()),
    );
  }

  // The bucket used now can only be changed when no images are stored there,
  // they would not be found anymore otherwise
  private async checkBucketIsEmpty(): AsyncFailable<true> {
    let files: number;
    try {
      files = (await this.maintenance.status()).files.objectStorage;
    } catch (e) {
      return Fail(FT.Database, e);
    }
    if (files === 0) return true;

    return Fail(
      FT.Conflict,
      `The bucket "${this.runningStorage().s3?.bucket}" still holds ${files} image ${files === 1 ? 'file' : 'files'}. Move them to the database first: store new images in the database, restart, and move the existing images there. Then the bucket can be changed.`,
    );
  }
}
