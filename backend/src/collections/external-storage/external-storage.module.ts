import { Module } from '@nestjs/common';
import { DiskStorageModule } from '../disk-storage/disk-storage.module.js';
import { ObjectStorageModule } from '../object-storage/object-storage.module.js';
import { ExternalStorageService } from './external-storage.service.js';

@Module({
  imports: [ObjectStorageModule, DiskStorageModule],
  providers: [ExternalStorageService],
  exports: [ExternalStorageService, ObjectStorageModule, DiskStorageModule],
})
export class ExternalStorageModule {}
