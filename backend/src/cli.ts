// Command line maintenance tool, run with `node dist/cli.js <command>`.
// Uses the same PICSUR_* environment variables as the server.

import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ImageDBModule } from './collections/image-db/image-db.module.js';
import {
  formatBytes,
  ImageStorageMaintenanceService,
} from './collections/image-db/image-storage-maintenance.service.js';
import { ObjectStorageService } from './collections/object-storage/object-storage.service.js';
import { EarlyConfigModule } from './config/early/early-config.module.js';
import { StorageConfigService } from './config/early/storage.config.service.js';
import { DatabaseModule } from './database/database.module.js';

const usage = `Usage: node dist/cli.js <command>

Commands:
  storage status          Show where image data is stored
  storage migrate         Move image data to the storage configured with
                          PICSUR_STORAGE_DRIVER. Cached conversions stored
                          elsewhere are dropped, they are made again when
                          needed. Can be run while Picsur is running.
  storage gc [--dry-run] [--min-age <seconds>]
                          Delete objects in the bucket that no image uses.
                          Objects younger than an hour are skipped, they
                          might belong to an upload that is in progress.
`;

@Module({
  imports: [EarlyConfigModule, DatabaseModule, ImageDBModule],
})
class CliModule {}

async function main(args: string[]): Promise<number> {
  const [group, command, ...flags] = args;
  if (group !== 'storage' || !['status', 'migrate', 'gc'].includes(command)) {
    console.log(usage);
    return group === undefined || group === '--help' ? 0 : 1;
  }

  const app = await NestFactory.createApplicationContext(CliModule, {
    logger: ['error', 'warn', 'log'],
  });
  const logger = new Logger('Storage');

  try {
    const maintenance = app.get(ImageStorageMaintenanceService);
    const objectStorage = app.get(ObjectStorageService);
    const driver = app.get(StorageConfigService).getDriver();

    if (command === 'status') {
      const status = await maintenance.status();
      logger.log(`New images are stored in: ${driver}`);
      logger.log(
        `Image files: ${status.files.database} in the database, ${status.files.objectStorage} in object storage`,
      );
      logger.log(
        `Cached conversions: ${status.derivatives.database} in the database, ${status.derivatives.objectStorage} in object storage`,
      );
    } else if (command === 'migrate') {
      logger.log(`Moving all image data to: ${driver}`);
      const result = await maintenance.migrate();
      logger.log(
        `Done, moved ${result.moved} files (${formatBytes(
          result.movedBytes,
        )}) and dropped ${result.droppedDerivatives} cached conversions`,
      );
      if (result.failed > 0) {
        logger.error(
          `${result.failed} files could not be moved, see the errors above. Running this again retries them.`,
        );
        return 1;
      }
      if (objectStorage.isWriteTarget && result.moved > 0) {
        logger.log(
          'Postgres only gives the freed up space back to the system after a ' +
            '"VACUUM FULL e_image_file_backend, e_image_derivative_backend;" ' +
            '(which locks those tables while it runs)',
        );
      }
    } else if (command === 'gc') {
      if (!objectStorage.isConfigured) {
        logger.error('No bucket is configured, there is nothing to clean up');
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
        `${dryRun ? 'Would delete' : 'Deleted'} ${result.orphanedObjects} unused objects` +
          (result.orphanedImages > 0
            ? `, including everything of ${result.orphanedImages} deleted images`
            : ''),
      );
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
