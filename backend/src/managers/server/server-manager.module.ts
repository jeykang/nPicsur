import { Module } from '@nestjs/common';
import { ImageDBModule } from '../../collections/image-db/image-db.module.js';
import { ExternalStorageModule } from '../../collections/external-storage/external-storage.module.js';
import { ServerSettingsDbModule } from '../../collections/server-settings-db/server-settings-db.module.js';
import { SystemStateDbModule } from '../../collections/system-state-db/system-state-db.module.js';
import { EarlyConfigModule } from '../../config/early/early-config.module.js';
import { ServerSettingsService } from './server-settings.service.js';
import { StorageMigrationService } from './storage-migration.service.js';

@Module({
  imports: [
    EarlyConfigModule,
    ServerSettingsDbModule,
    SystemStateDbModule,
    ImageDBModule,
    ExternalStorageModule,
  ],
  providers: [ServerSettingsService, StorageMigrationService],
  exports: [ServerSettingsService, StorageMigrationService],
})
export class ServerManagerModule {}
