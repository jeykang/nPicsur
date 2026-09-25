import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { EUser } from 'picsur-shared/dist/entities/user.entity';
import {
  AsyncFailable,
  Fail,
  FT,
  HasFailed,
  ThrowIfFailed,
} from 'picsur-shared/dist/types/failable';
import { UserDbService } from '../../../collections/user-db/user-db.service.js';
import { Permission } from '../../../models/constants/permissions.const.js';
import { EUserBackend2EUser } from '../../../models/transformers/user.transformer.js';

@Injectable()
export class LocalAuthStrategy extends PassportStrategy(Strategy, 'local') {
  constructor(private readonly usersService: UserDbService) {
    super();
  }

  async validate(username: string, password: string): AsyncFailable<EUser> {
    const start = Date.now();
    // All this does is call the usersservice authenticate for authentication
    const user = await this.usersService.authenticate(username, password);

    // Wait atleast 500ms
    const wait = 450 - (Date.now() - start);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));

    const authenticated = ThrowIfFailed(user);

    // The route only checks the permissions of whoever makes the request,
    // which is the guest user at this point. So check the user logging in
    // may actually do so.
    const permissions = await this.usersService.getPermissions(
      authenticated.id,
    );
    if (HasFailed(permissions)) throw permissions;
    if (!permissions.includes(Permission.UserLogin)) {
      throw Fail(FT.Permission, 'This user is not allowed to log in');
    }

    return EUserBackend2EUser(authenticated);
  }
}
