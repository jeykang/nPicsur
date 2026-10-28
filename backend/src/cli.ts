// Command line maintenance tool, run with `node dist/cli.js <command>`.
// Uses the same PICSUR_* environment variables and server settings as the
// server.

import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  SecretServerSettings,
  ServerSetting,
  ServerSettingEnvName,
  ServerSettingList,
} from 'picsur-shared/dist/dto/server-settings.dto';
import { HasFailed } from 'picsur-shared/dist/types/failable';
import { ImageDBModule } from './collections/image-db/image-db.module.js';
import { ImageDBService } from './collections/image-db/image-db.service.js';
import {
  formatBytes,
  ImageStorageMaintenanceService,
  LocationCounts,
} from './collections/image-db/image-storage-maintenance.service.js';
import { ExternalStorageService } from './collections/external-storage/external-storage.service.js';
import { EarlyConfigModule } from './config/early/early-config.module.js';
import { StorageConfigService } from './config/early/storage.config.service.js';
import {
  EnvServerSetting,
  LoadStoredServerSettings,
  RemoveStoredServerSettings,
  RunningStoredServerSettings,
  ServerSettingDefault,
  UseStoredServerSettings,
} from './config/server-settings.js';
import { DatabaseModule } from './database/database.module.js';

const usage = `Usage: node dist/cli.js <command>

Commands:
  storage status          Show image storage locations and usage
  storage migrate         Move images to the configured storage destination.
                          Uses saved settings or PICSUR_STORAGE_DRIVER.
                          Discarded conversions are recreated on demand.
                          Safe to run while Picsur is active.
  storage gc [--dry-run] [--min-age <seconds>]
                          Delete unused files from the bucket and directory.
                          Skips files under an hour old to protect uploads
                          in progress; --min-age changes this cutoff.
  images delete-orphaned [--dry-run]
                          Delete images left by users deleted in Picsur 0.5.
                          Newer versions delete images with their owner.
  settings list           Show settings and their sources, in priority order:
                          saved value, environment variable, default.
  settings reset <setting>...
                          Clear saved values to restore environment values
                          or defaults. Accepts names such as password_login
                          or PICSUR_PASSWORD_LOGIN. Restart Picsur to apply.
`;

const commands: Record<string, string[]> = {
  storage: ['status', 'migrate', 'gc'],
  images: ['delete-orphaned'],
  settings: ['list', 'reset'],
};

// Accepts both password_login and PICSUR_PASSWORD_LOGIN
function settingByName(name: string): ServerSetting | null {
  const key = name.toLowerCase().replace(/^picsur_/, '');
  return ServerSettingList.find((setting) => setting === key) ?? null;
}

function listSettings() {
  const saved = RunningStoredServerSettings();
  const width = Math.max(...ServerSettingList.map((key) => key.length)) + 2;
  for (const key of ServerSettingList) {
    const env = ServerSettingEnvName(key);
    const fromEnv = EnvServerSetting(key);
    const secret = SecretServerSettings.includes(key);
    const show = (value: string) => (secret ? '(secret)' : value);

    let line: string;
    if (saved.has(key)) {
      line = `${show(saved.get(key)!)}, saved on the settings page`;
      if (fromEnv !== undefined) line += `, before ${env}`;
    } else if (fromEnv !== undefined) {
      line = `${show(fromEnv)}, from ${env}`;
    } else {
      const fallback = ServerSettingDefault(key);
      line = fallback === null ? 'not set' : `${fallback}, the default`;
    }
    console.log(key.padEnd(width) + line);
  }
}

async function resetSettings(names: string[]): Promise<number> {
  const keys: ServerSetting[] = [];
  for (const name of names) {
    const key = settingByName(name);
    if (key === null) {
      console.error(
        `Unknown setting "${name}". Run "settings list" for available settings`,
      );
      return 1;
    }
    keys.push(key);
  }
  if (keys.length === 0) {
    console.log(usage);
    return 1;
  }

  const removed = await RemoveStoredServerSettings(keys);
  for (const key of keys) {
    if (!removed.includes(key)) {
      console.log(`${key}: nothing was saved`);
      continue;
    }
    const fromEnv = EnvServerSetting(key);
    const fallback = ServerSettingDefault(key);
    console.log(
      `${key}: removed, ` +
        (fromEnv !== undefined
          ? `${ServerSettingEnvName(key)} applies`
          : fallback === null
            ? 'it is not set'
            : `the default (${fallback}) applies`),
    );
  }
  if (removed.length > 0) {
    console.log('Restart Picsur for this to take effect');
  }
  return 0;
}

@Module({
  imports: [EarlyConfigModule, DatabaseModule, ImageDBModule],
})
class CliModule {}

async function main(args: string[]): Promise<number> {
  const [group, command, ...flags] = args;
  if (
    !Object.hasOwn(commands, group ?? '') ||
    !commands[group].includes(command)
  ) {
    console.log(usage);
    return group === undefined || group === '--help' ? 0 : 1;
  }

  UseStoredServerSettings(await LoadStoredServerSettings());
  if (group === 'settings') {
    if (command === 'list') {
      listSettings();
      return 0;
    }
    return resetSettings(flags);
  }

  const app = await NestFactory.createApplicationContext(CliModule, {
    logger: ['error', 'warn', 'log'],
  });
  const logger = new Logger(group === 'images' ? 'Images' : 'Storage');

  try {
    const maintenance = app.get(ImageStorageMaintenanceService);
    const storages = app.get(ExternalStorageService);
    const driver = app.get(StorageConfigService).getDriver();
    const counted = (counts: LocationCounts) =>
      `${counts.database} in the database, ${counts.s3} in S3, ${counts.filesystem} on disk`;

    if (command === 'status') {
      const status = await maintenance.status();
      logger.log(`New images are stored in: ${driver}`);
      logger.log(`Image files: ${counted(status.files)}`);
      logger.log(`Converted versions: ${counted(status.derivatives)}`);
    } else if (command === 'migrate') {
      logger.log(`Moving all image data to: ${driver}`);
      const result = await maintenance.migrate();
      logger.log(
        `Done, moved ${result.moved} files (${formatBytes(
          result.movedBytes,
        )}) and dropped ${result.droppedDerivatives} converted versions`,
      );
      if (result.failed > 0) {
        logger.error(
          `${result.failed} files could not be moved, see the errors above. Running this again retries them.`,
        );
        return 1;
      }
      if (storages.writeTarget !== null && result.moved > 0) {
        logger.log(
          'Postgres only gives the freed up space back to the system after a ' +
            '"VACUUM FULL e_image_file_backend, e_image_derivative_backend;" ' +
            '(which locks those tables while it runs)',
        );
      }
    } else if (command === 'gc') {
      if (storages.configured.length === 0) {
        logger.error('No bucket or directory configured. Nothing to clean up');
        return 1;
      }
      const dryRun = flags.includes('--dry-run');
      const minAgeFlag = flags.indexOf('--min-age');
      const minAgeSeconds =
        minAgeFlag >= 0 ? Number(flags[minAgeFlag + 1]) : undefined;
      if (minAgeSeconds !== undefined && !(minAgeSeconds >= 0)) {
        console.log(usage);
        return 1;
      }
      const result = await maintenance.gc(
        dryRun,
        minAgeSeconds === undefined ? undefined : minAgeSeconds * 1000,
      );
      logger.log(
        `${dryRun ? 'Would delete' : 'Deleted'} ${result.orphanedObjects} unused files` +
          (result.orphanedImages > 0
            ? `, including everything of ${result.orphanedImages} deleted images`
            : ''),
      );
    } else if (command === 'delete-orphaned') {
      const images = app.get(ImageDBService);
      if (flags.includes('--dry-run')) {
        const orphaned = await images.countOrphaned();
        if (HasFailed(orphaned)) {
          logger.error(orphaned.getReason(), orphaned.getDebugMessage());
          return 1;
        }
        const total = [...orphaned.values()].reduce((a, b) => a + b, 0);
        logger.log(
          `Would delete ${total} images of ${orphaned.size} users that no longer exist`,
        );
      } else {
        const deleted = await images.deleteOrphaned();
        if (HasFailed(deleted)) {
          logger.error(deleted.getReason(), deleted.getDebugMessage());
          return 1;
        }
        logger.log(`Deleted ${deleted} images of users that no longer exist`);
      }
    }
    return 0;
  } finally {
    await app.close();
  }
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
