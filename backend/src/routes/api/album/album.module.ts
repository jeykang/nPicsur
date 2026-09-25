import { Module } from '@nestjs/common';
import { AlbumDbModule } from '../../../collections/album-db/album-db.module.js';
import { UserDbModule } from '../../../collections/user-db/user-db.module.js';
import { AlbumController } from './album.controller.js';

@Module({
  imports: [AlbumDbModule, UserDbModule],
  controllers: [AlbumController],
})
export class AlbumApiModule {}
