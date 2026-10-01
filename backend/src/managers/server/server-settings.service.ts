import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import {
  OidcTestResponse,
  ServerSettingsResponse,
  StorageStatusResponse,
  StorageTestResponse,
} from 'picsur-shared/dist/dto/api/server.dto';
import {
  OidcSettings,
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
import {
  DiskStorageService,
  TestDiskStorage,
} from '../../collections/disk-storage/disk-storage.service.js';
import { TestS3Storage } from '../../collections/object-storage/object-storage.service.js';
import { ServerSettingsDbService } from '../../collections/server-settings-db/server-settings-db.service.js';
import { SystemStateDbService } from '../../collections/system-state-db/system-state-db.service.js';
import {
  BuildLoginConfig,
  LoginConfig,
} from '../../config/early/login.config.service.js';
import {
  BuildStorageConfig,
  ChangedStorageLocations,
  ExternalStorageDriver,
  StorageConfig,
  StorageConfigService,
  StorageDriver,
} from '../../config/early/storage.config.service.js';
import {
  EnvServerSetting,
  RunningStoredServerSettings,
  SavedFirst,
  ServerSettingDefault,
  ServerSettingResolver,
  ServerSettingsOrderState,
  StoredServerSettings,
} from '../../config/server-settings.js';
import {
  EncryptionKeyEnv,
  EncryptionKeyIsShort,
  EncryptionKeySource,
  GeneratedKeyState,
  NewEncryptionKey,
  UseGeneratedEncryptionKey,
} from '../../config/settings-encryption.js';
import { RequestRestart, RestartError, StartedAt } from '../../util/restart.js';
import { TestOidc } from '../auth/oidc.js';
import { OidcService } from '../auth/oidc.service.js';
import { StorageMigrationService } from './storage-migration.service.js';

interface PlannedChange {
  changes: Map<ServerSetting, string | null>;
  stored: StoredServerSettings;
  storage: StorageConfig;
  login: LoginConfig;
}

// The server settings as the settings page shows and changes them
@Injectable()
export class ServerSettingsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ServerSettingsService.name);

  constructor(
    private readonly settingsDb: ServerSettingsDbService,
    private readonly stateDb: SystemStateDbService,
    private readonly maintenance: ImageStorageMaintenanceService,
    private readonly migration: StorageMigrationService,
    private readonly storageConfig: StorageConfigService,
    private readonly diskStorage: DiskStorageService,
    private readonly oidc: OidcService,
  ) {}

  async onApplicationBootstrap() {
    if (EncryptionKeyIsShort()) {
      this.logger.warn(
        `${EncryptionKeyEnv} is shorter than 16 characters, which makes the secrets it protects easier to reveal. Use a long random value, and save the secrets again after changing it.`,
      );
    }
    await this.prepareEncryption();
    await this.markSavedFirst();
  }

  // Makes sure there is a key to encrypt secrets with. Without
  // PICSUR_ENCRYPTION_KEY, one is generated and kept in the database. When it
  // is set, secrets saved with the generated key are moved over to it, and the
  // generated key is removed once nothing needs it anymore.
  async prepareEncryption() {
    if (EncryptionKeySource() === null) {
      let key = await this.stateDb.get(GeneratedKeyState);
      if (!HasFailed(key) && key === null) {
        // Fails when another instance created one at the same time
        await this.stateDb.set(GeneratedKeyState, NewEncryptionKey());
        key = await this.stateDb.get(GeneratedKeyState);
        if (!HasFailed(key) && key !== null) {
          this.logger.log(
            `Generated a key to encrypt secrets with, it is kept in the database. Set ${EncryptionKeyEnv} to protect secrets from copies of the database as well.`,
          );
        }
      }
      if (HasFailed(key) || key === null) {
        this.logger.error(
          `There is no key to encrypt secrets with, they can not be saved on the settings page. Set ${EncryptionKeyEnv}.`,
        );
        return;
      }
      UseGeneratedEncryptionKey(key);
    }

    if (EncryptionKeySource() !== 'environment') return;
    const result = await this.settingsDb.reencryptSecrets();
    if (HasFailed(result)) {
      result.print(this.logger, { prefix: 'Encrypting secrets:' });
      return;
    }
    if (result.reencrypted.length > 0) {
      this.logger.log(
        `Encrypted ${result.reencrypted.map(ServerSettingEnvName).join(', ')} with ${EncryptionKeyEnv}`,
      );
    }
    if (result.usesGeneratedKey) return;

    const generated = await this.stateDb.get(GeneratedKeyState);
    if (HasFailed(generated) || generated === null) return;
    const cleared = await this.stateDb.clear(GeneratedKeyState);
    if (HasFailed(cleared)) {
      cleared.print(this.logger);
      return;
    }
    UseGeneratedEncryptionKey(null);
    this.logger.log(
      `Removed the generated encryption key from the database, ${EncryptionKeyEnv} is used instead`,
    );
  }

  // Settings saved from now on come before the environment. When the settings
  // could not be read before Picsur started, as they are new, there are no
  // copies of the environment to drop, see config/server-settings.ts.
  async markSavedFirst() {
    const order = await this.stateDb.get(ServerSettingsOrderState);
    if (HasFailed(order)) {
      order.print(this.logger);
      return;
    }
    if (order === SavedFirst) return;
    const marked = await this.stateDb.set(ServerSettingsOrderState, SavedFirst);
    if (HasFailed(marked)) marked.print(this.logger);
  }

  async describe(): AsyncFailable<ServerSettingsResponse> {
    const stored = await this.settingsDb.getAll();
    if (HasFailed(stored)) return stored;
    return this.describeStored(stored);
  }

  // Stores the given settings, which take effect when Picsur restarts. A
  // value of null removes what is saved, so the environment or the default
  // applies again.
  async update(
    values: Record<string, string | null>,
    // The admin making the changes
    userId: string,
  ): AsyncFailable<ServerSettingsResponse> {
    const plan = await this.plan(values, true);
    if (HasFailed(plan)) return plan;
    if (plan.changes.size === 0) return this.describeStored(plan.stored);

    // Keep what is stored where it can be found
    const movedLocations = ChangedStorageLocations(
      this.runningStorage(),
      plan.storage,
    );
    for (const location of movedLocations) {
      const kept = await this.checkLocationIsEmpty(location);
      if (HasFailed(kept)) return kept;
    }

    // Only storage that works is stored, so Picsur can start with it. It is
    // not needed for switching back to the database, and moving images there.
    const changed = [...plan.changes.keys()];
    const driverChanged = changed.includes(ServerSetting.StorageDriver);
    const bucketChanged = changed.some(
      (key) =>
        StorageSettings.includes(key) &&
        key !== ServerSetting.StorageDriver &&
        key !== ServerSetting.StoragePath,
    );
    if (
      plan.storage.s3 !== null &&
      (bucketChanged ||
        (driverChanged && plan.storage.driver === StorageDriver.S3))
    ) {
      const tested = await TestS3Storage(plan.storage.s3);
      if (HasFailed(tested)) return tested;
    }
    if (
      plan.storage.filesystem !== null &&
      (changed.includes(ServerSetting.StoragePath) ||
        (driverChanged && plan.storage.driver === StorageDriver.Filesystem))
    ) {
      const tested = await TestDiskStorage(plan.storage.filesystem);
      if (HasFailed(tested)) return tested;
    }

    // Like storage, a provider is only stored when it can be reached
    const loginChanged = changed.some(
      (key) =>
        OidcSettings.includes(key) || key === ServerSetting.PasswordLogin,
    );
    if (
      plan.login.oidc !== null &&
      changed.some((key) => OidcSettings.includes(key))
    ) {
      const tested = await TestOidc(plan.login.oidc);
      if (HasFailed(tested)) return tested;
    }
    if (!plan.login.password && loginChanged) {
      const safe = await this.checkPasswordLoginCanBeOff(plan.login, userId);
      if (HasFailed(safe)) return safe;
    }

    const updated = await this.settingsDb.update(plan.changes);
    if (HasFailed(updated)) return updated;
    this.logger.log(
      `Changed server settings: ${[...plan.changes.keys()].join(', ')}`,
    );

    // Cached conversions in the old bucket or directory would not be found
    // anymore, they are made again when needed
    for (const location of movedLocations) {
      await this.maintenance
        .dropDerivativesIn(location)
        .catch((e) =>
          this.logger.warn(`Dropping cached conversions: ${String(e)}`),
        );
    }

    return this.describeStored(plan.stored);
  }

  // Tries out the bucket or directory the given changes would result in
  async testStorage(
    values: Record<string, string | null>,
    storage: `${ExternalStorageDriver}`,
  ): AsyncFailable<StorageTestResponse> {
    const plan = await this.plan(values);
    if (HasFailed(plan)) return plan;

    if (storage === StorageDriver.S3) {
      const s3 = plan.storage.s3;
      if (s3 === null) return Fail(FT.BadRequest, 'There is no bucket to test');
      const tested = await TestS3Storage(s3);
      if (HasFailed(tested)) return tested;
      return {
        driver: storage,
        location: s3.bucket,
        created: tested.created,
        warning: null,
      };
    }

    const filesystem = plan.storage.filesystem;
    if (filesystem === null) {
      return Fail(FT.BadRequest, 'There is no directory to test');
    }
    const tested = await TestDiskStorage(filesystem);
    if (HasFailed(tested)) return tested;
    return {
      driver: storage,
      location: filesystem.path,
      created: tested.created,
      warning: tested.warning,
    };
  }

  // Tries out the provider the given changes would result in
  async testOidc(
    values: Record<string, string | null>,
  ): AsyncFailable<OidcTestResponse> {
    const plan = await this.plan(values);
    if (HasFailed(plan)) return plan;
    if (plan.login.oidc === null) {
      return Fail(FT.BadRequest, 'Set an issuer and a client id first');
    }
    return TestOidc(plan.login.oidc);
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
    for (const location of ChangedStorageLocations(
      this.runningStorage(),
      next,
    )) {
      const kept = await this.checkLocationIsEmpty(location);
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
        path: this.storageConfig.getFilesystemConfig()?.path ?? null,
        warning: this.diskStorage.warning,
        files: status.files,
        derivatives: status.derivatives,
        migration: this.migration.getState(),
      };
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  // Works out what the given changes result in, and whether they are valid
  private async plan(
    values: Record<string, string | null>,
    saving = false,
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

      if (value !== null) {
        const valid = ServerSettingValidators[setting].safeParse(value);
        if (!valid.success) {
          return Fail(
            FT.UsrValidation,
            `${ServerSettingEnvName(setting)}: ${valid.error.issues[0]?.message ?? 'Invalid value'}`,
          );
        }
        if (
          saving &&
          SecretServerSettings.includes(setting) &&
          EncryptionKeySource() === null
        ) {
          return Fail(
            FT.Internal,
            'There is no key to encrypt secrets with, the server log says why',
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

    // Settings that do not fit together are not stored, unless they already
    // did not, for example because of the environment
    const login = BuildLoginConfig(ServerSettingResolver(stored));
    if (
      saving &&
      login.problem !== null &&
      login.problem !== BuildLoginConfig(ServerSettingResolver(current)).problem
    ) {
      return Fail(FT.UsrValidation, login.problem);
    }

    return { changes, stored, storage, login: login.config };
  }

  // Turning off password login can not leave anyone without a way to log in,
  // the admin who does it in particular. Logins are linked to one provider,
  // so changing that is only possible with password login on.
  private async checkPasswordLoginCanBeOff(
    login: LoginConfig,
    userId: string,
  ): AsyncFailable<true> {
    const running = this.oidc.config;
    if (
      running === null ||
      login.oidc === null ||
      running.issuer !== login.oidc.issuer ||
      running.clientId !== login.oidc.clientId
    ) {
      return Fail(
        FT.Conflict,
        'Password login can only be turned off once logging in with this OpenID Connect provider works: save it, restart, and link your own account first. To change the provider, turn password login on first.',
      );
    }

    const linked = await this.oidc.linkedLogin(userId);
    if (HasFailed(linked)) return linked;
    if (linked === null) {
      return Fail(
        FT.Conflict,
        `Link your own account to ${running.name} in your account settings first, or you could not log in anymore`,
      );
    }
    return true;
  }

  private describeStored(stored: StoredServerSettings): ServerSettingsResponse {
    const now = ServerSettingResolver(stored);
    const running = ServerSettingResolver(RunningStoredServerSettings());

    return {
      settings: ServerSettingList.map((key) => {
        const saved = stored.get(key);
        const fromEnv = EnvServerSetting(key);
        const secret = SecretServerSettings.includes(key);
        return {
          key,
          value: saved === undefined || secret ? null : saved,
          saved: saved !== undefined,
          env: ServerSettingEnvName(key),
          env_value: fromEnv === undefined || secret ? null : fromEnv,
          env_set: fromEnv !== undefined,
          default: ServerSettingDefault(key),
          source:
            saved !== undefined
              ? 'settings'
              : fromEnv !== undefined
                ? 'environment'
                : 'default',
          set: saved !== undefined || fromEnv !== undefined,
        };
      }),
      restart_needed: ServerSettingList.some(
        (key) => now(key) !== running(key),
      ),
      restart_error: RestartError(),
      started_at: StartedAt(),
      encryption_key: EncryptionKeySource(),
    };
  }

  private runningStorage(): StorageConfig {
    return BuildStorageConfig(
      ServerSettingResolver(RunningStoredServerSettings()),
    );
  }

  // The bucket or directory used now can only be changed when no images are
  // stored there, they would not be found anymore otherwise
  private async checkLocationIsEmpty(
    location: ExternalStorageDriver,
  ): AsyncFailable<true> {
    let files: number;
    try {
      files = (await this.maintenance.status()).files[location];
    } catch (e) {
      return Fail(FT.Database, e);
    }
    if (files === 0) return true;

    const running = this.runningStorage();
    const where =
      location === StorageDriver.S3
        ? `The bucket "${running.s3?.bucket}"`
        : `The directory "${running.filesystem?.path}"`;
    const what = location === StorageDriver.S3 ? 'bucket' : 'directory';
    return Fail(
      FT.Conflict,
      `${where} still holds ${files} image ${files === 1 ? 'file' : 'files'}. Move them elsewhere first: store new images somewhere else, restart, and move the existing images there. Then the ${what} can be changed.`,
    );
  }
}
