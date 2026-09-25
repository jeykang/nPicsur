import { Module } from '@nestjs/common';
import { ImageDBModule } from '../../../collections/image-db/image-db.module.js';
import { GalleryController } from './gallery.controller.js';

@Module({
  imports: [ImageDBModule],
  controllers: [GalleryController],
})
export class GalleryApiModule {}
