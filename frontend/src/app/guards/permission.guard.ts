import { Injectable } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  CanActivate,
  CanActivateChild,
  Router,
} from '@angular/router';
import { isPermissionsArray } from 'picsur-shared/dist/validators/permissions.validator';
import { PRouteData } from '../models/dto/picsur-routes.dto';
import { PermissionService } from '../services/api/permission.service';
import { StaticInfoService } from '../services/api/static-info.service';
import { Logger } from '../services/logger/logger.service';

@Injectable({
  providedIn: 'root',
})
export class PermissionGuard implements CanActivate, CanActivateChild {
  private readonly logger = new Logger(PermissionGuard.name);

  constructor(
    private readonly permissionService: PermissionService,
    private readonly staticInfo: StaticInfoService,
    private readonly router: Router,
  ) {}

  async canActivateChild(childRoute: ActivatedRouteSnapshot) {
    return await this.can(childRoute);
  }

  async canActivate(route: ActivatedRouteSnapshot) {
    return await this.can(route);
  }

  private async can(route: ActivatedRouteSnapshot) {
    const requiredPermissions: string[] = this.nestedPermissions(route);

    // This waits for as long as the server can not be reached
    const ourPermissions = await this.permissionService.getLoadedSnapshot();
    const weHavePermission = requiredPermissions.every((permission) =>
      ourPermissions.includes(permission),
    );

    if (!weHavePermission) {
      await this.checkPermissionsExist(requiredPermissions);
      this.router.navigate(['/error/401'], { replaceUrl: true });
    }

    return weHavePermission;
  }

  // Nobody has permissions that do not exist, so a route requiring one is a
  // mistake
  private async checkPermissionsExist(permissions: string[]) {
    const allPermissions = await this.staticInfo.getAllPermissions();
    if (!isPermissionsArray(permissions, allPermissions)) {
      this.logger.error(
        `Permissions array is invalid: "${permissions}" (available: ${allPermissions})`,
      );
    }
  }

  // This aggregates nested permission for deep routes
  private nestedPermissions(route: ActivatedRouteSnapshot): string[] {
    const data: PRouteData = route.data;

    let permissions: string[] = [];
    if (data?.permissions) {
      permissions = permissions.concat(data.permissions);
    }
    if (route.firstChild) {
      permissions = permissions.concat(
        this.nestedPermissions(route.firstChild),
      );
    }
    return permissions;
  }
}
