import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EAlbumImageBackend } from '../../database/entities/albums/album-image.entity.js';
import { EAlbumBackend } from '../../database/entities/albums/album.entity.js';
import { AlbumDbService } from './album-db.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([EAlbumBackend, EAlbumImageBackend])],
  providers: [AlbumDbService],
  exports: [AlbumDbService],
})
export class AlbumDbModule {}
