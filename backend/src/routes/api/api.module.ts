import { Module } from '@nestjs/common';
import { AlbumApiModule } from './album/album.module.js';
import { ApiKeysModule } from './apikeys/apikeys.module.js';
import { GalleryApiModule } from './gallery/gallery.module.js';
import { InfoModule } from './info/info.module.js';
import { PrefModule } from './pref/pref.module.js';
import { RolesApiModule } from './roles/roles.module.js';
import { ServerApiModule } from './server/server.module.js';
import { UsageApiModule } from './usage/usage.module.js';
import { UserApiModule } from './user/user.module.js';

@Module({
  imports: [
    UserApiModule,
    PrefModule,
    InfoModule,
    RolesApiModule,
    ApiKeysModule,
    UsageApiModule,
    GalleryApiModule,
    AlbumApiModule,
    ServerApiModule,
  ],
})
export class PicsurApiModule {}
