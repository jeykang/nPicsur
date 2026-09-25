import { Fail, FT } from 'picsur-shared/dist/types/failable';
import { Permissions } from '../constants/permissions.const.js';

// Whoever manages users or roles can only hand out permissions they have
// themselves, and can only change users and roles that have no permissions
// beyond their own. Otherwise anyone allowed to manage users or roles could
// make themselves a full administrator.
export function AssertWithinOwnPermissions(
  own: Permissions,
  other: Permissions,
  what: string,
): void {
  const missing = other.filter((permission) => !own.includes(permission));
  if (missing.length > 0) {
    throw Fail(
      FT.Permission,
      `You can not ${what} with permissions you do not have yourself`,
      `Missing permissions: ${missing.join(', ')}`,
    );
  }
}
