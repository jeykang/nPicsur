import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ObjectStorageModule } from '../object-storage/object-storage.module.js';
import { EImageDerivativeBackend } from '../../database/entities/images/image-derivative.entity.js';
import { EImageFileBackend } from '../../database/entities/images/image-file.entity.js';
import { EImageBackend } from '../../database/entities/images/image.entity.js';
import { ImageDBService } from './image-db.service.js';
import { ImageFileDBService } from './image-file-db.service.js';
import { ImageStorageMaintenanceService } from './image-storage-maintenance.service.js';

@Module({
  imports: [
    ObjectStorageModule,
    TypeOrmModule.forFeature([
      EImageBackend,
      EImageFileBackend,
      EImageDerivativeBackend,
    ]),
  ],
  providers: [
    ImageDBService,
    ImageFileDBService,
    ImageStorageMaintenanceService,
  ],
  exports: [ImageDBService, ImageFileDBService, ImageStorageMaintenanceService],
})
export class ImageDBModule {}
