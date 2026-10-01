import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HasFailed } from 'picsur-shared/dist/types/failable';
import { ERoleBackend } from '../../database/entities/users/role.entity.js';
import {
  ImmutableRolesList,
  SystemRoleDefaults,
  SystemRolesList,
} from '../../models/constants/roles.const.js';
import { RoleDbService } from './role-db.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([ERoleBackend])],
  providers: [RoleDbService],
  exports: [RoleDbService],
})
export class RoleDbModule implements OnModuleInit {
  private readonly logger = new Logger(RoleDbModule.name);

  constructor(private readonly rolesService: RoleDbService) {}

  async onModuleInit() {
    await this.ensureSystemRolesExist();
    await this.updateImmutableRoles();
  }

  private async ensureSystemRolesExist() {
    for (const systemRole of SystemRolesList) {
      this.logger.verbose(`Ensuring system role "${systemRole}" exists`);

      const exists = await this.rolesService.exists(systemRole);
      if (exists) {
        this.logger.verbose(`System role "${systemRole}" already exists`);
        continue;
      }

      const newRole = await this.rolesService.create(
        systemRole,
        SystemRoleDefaults[systemRole],
      );
      if (HasFailed(newRole)) {
        this.logger.error(
          `Failed to create system role "${systemRole}" because: ${newRole.getReason()}`,
        );
        continue;
      }
    }
  }

  private async updateImmutableRoles() {
    // Immutable roles cannot be updated via the gui
    // They therefore do have to be kept up to date from the backend

    for (const immutableRole of ImmutableRolesList) {
      this.logger.verbose(
        `Updating permissions for immutable role "${immutableRole}"`,
      );

      const result = await this.rolesService.setPermissions(
        immutableRole,
        SystemRoleDefaults[immutableRole],
        true, // Manual bypass for immutable roles
      );
      if (HasFailed(result)) {
        this.logger.error(
          `Failed to update permissions for immutable role "${immutableRole}" because: ${result.getReason()}`,
        );
        continue;
      }
    }
  }
}
