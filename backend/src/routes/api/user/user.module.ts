import { Module } from '@nestjs/common';
import { RoleDbModule } from '../../../collections/role-db/role-db.module.js';
import { LateConfigModule } from '../../../config/late/late-config.module.js';
import { AuthManagerModule } from '../../../managers/auth/auth.module.js';
import { UserAdminController } from './user-manage.controller.js';
import { UserOidcController } from './user-oidc.controller.js';
import { UserController } from './user.controller.js';

@Module({
  imports: [AuthManagerModule, RoleDbModule, LateConfigModule],
  controllers: [UserController, UserAdminController, UserOidcController],
})
export class UserApiModule {}
