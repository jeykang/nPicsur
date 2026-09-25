import { Body, Controller, Get, Logger, Post } from '@nestjs/common';
import {
  RoleCreateRequest,
  RoleCreateResponse,
  RoleDeleteRequest,
  RoleDeleteResponse,
  RoleInfoRequest,
  RoleInfoResponse,
  RoleListResponse,
  RoleUpdateRequest,
  RoleUpdateResponse,
  SpecialRolesResponse,
} from 'picsur-shared/dist/dto/api/roles.dto';
import { FT, Fail, ThrowIfFailed } from 'picsur-shared/dist/types/failable';
import { RoleDbService } from '../../../collections/role-db/role-db.service.js';
import { UserDbService } from '../../../collections/user-db/user-db.service.js';
import { EasyThrottle } from '../../../decorators/easy-throttle.decorator.js';
import {
  GetPermissions,
  RequiredPermissions,
} from '../../../decorators/permissions.decorator.js';
import { Returns } from '../../../decorators/returns.decorator.js';
import {
  Permission,
  type Permissions,
} from '../../../models/constants/permissions.const.js';
import {
  DefaultRolesList,
  ImmutableRolesList,
  RolePermissionsLocks,
  SoulBoundRolesList,
  UndeletableRolesList,
} from '../../../models/constants/roles.const.js';
import { AssertWithinOwnPermissions } from '../../../models/validators/permission-bounds.js';
import { isPermissionsArray } from '../../../models/validators/permissions.validator.js';

@Controller('api/roles')
@RequiredPermissions(Permission.RoleAdmin)
export class RolesController {
  private readonly logger = new Logger(RolesController.name);

  constructor(
    private readonly rolesService: RoleDbService,
    private readonly usersService: UserDbService,
  ) {}

  @Get('list')
  @Returns(RoleListResponse)
  async getRoles(): Promise<RoleListResponse> {
    const roles = ThrowIfFailed(await this.rolesService.findAll());

    return {
      results: roles,
      total: roles.length,
    };
  }

  @Post('info')
  @Returns(RoleInfoResponse)
  async getRole(@Body() body: RoleInfoRequest): Promise<RoleInfoResponse> {
    const role = ThrowIfFailed(await this.rolesService.findOne(body.name));

    return role;
  }

  @Post('update')
  @Returns(RoleUpdateResponse)
  @EasyThrottle(20)
  async updateRole(
    @Body() body: RoleUpdateRequest,
    @GetPermissions() own: Permissions,
  ): Promise<RoleUpdateResponse> {
    const permissions = body.permissions;
    if (!isPermissionsArray(permissions)) {
      throw Fail(FT.UsrValidation, 'Invalid permissions array');
    }

    const role = ThrowIfFailed(await this.rolesService.findOne(body.name));
    AssertWithinOwnPermissions(own, role.permissions, 'change roles');
    AssertWithinOwnPermissions(own, permissions, 'save roles');

    const updatedRole = ThrowIfFailed(
      await this.rolesService.setPermissions(body.name, permissions),
    );

    return updatedRole;
  }

  @Post('create')
  @Returns(RoleCreateResponse)
  @EasyThrottle(10)
  async createRole(
    @Body() role: RoleCreateRequest,
    @GetPermissions() own: Permissions,
  ): Promise<RoleCreateResponse> {
    const permissions = role.permissions;
    if (!isPermissionsArray(permissions)) {
      throw Fail(FT.UsrValidation, 'Invalid permissions array');
    }
    AssertWithinOwnPermissions(own, permissions, 'create roles');

    const newRole = ThrowIfFailed(
      await this.rolesService.create(role.name, permissions),
    );

    return newRole;
  }

  @Post('delete')
  @Returns(RoleDeleteResponse)
  async deleteRole(
    @Body() role: RoleDeleteRequest,
    @GetPermissions() own: Permissions,
  ): Promise<RoleDeleteResponse> {
    const existing = ThrowIfFailed(await this.rolesService.findOne(role.name));
    AssertWithinOwnPermissions(own, existing.permissions, 'delete roles');

    const deletedRole = ThrowIfFailed(
      await this.rolesService.delete(role.name),
    );

    ThrowIfFailed(await this.usersService.removeRoleEveryone(role.name));

    return deletedRole;
  }

  @Get('special')
  @Returns(SpecialRolesResponse)
  async getSpecialRoles(): Promise<SpecialRolesResponse> {
    return {
      SoulBoundRoles: SoulBoundRolesList,
      ImmutableRoles: ImmutableRolesList,
      UndeletableRoles: UndeletableRolesList,
      DefaultRoles: DefaultRolesList,
      LockedPermissions: RolePermissionsLocks,
    };
  }
}
