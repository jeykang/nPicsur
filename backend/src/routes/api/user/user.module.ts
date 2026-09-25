import { Module } from '@nestjs/common';
import { RoleDbModule } from '../../../collections/role-db/role-db.module.js';
import { AuthManagerModule } from '../../../managers/auth/auth.module.js';
import { UserAdminController } from './user-manage.controller.js';
import { UserController } from './user.controller.js';

@Module({
  imports: [AuthManagerModule, RoleDbModule],
  controllers: [UserController, UserAdminController],
})
export class UserApiModule {}
