import { EUser } from 'picsur-shared/dist/entities/user.entity';
import { EUserBackend } from '../../database/entities/users/user.entity.js';

export function EUserBackend2EUser(eUser: EUserBackend): EUser {
  // Make sure the password hash never ends up in a response
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { hashed_password, ...user } = eUser;
  return user as EUser;
}
