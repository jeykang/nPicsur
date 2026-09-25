import { z } from 'zod';
import { IsEntityID } from '../validators/entity-id.validator.js';
import { IsStringList } from '../validators/string-list.validator.js';
import { IsPlainTextPwd, IsUsername } from '../validators/user.validators.js';

export const SimpleUserSchema = z.object({
  username: IsUsername(),
  password: IsPlainTextPwd(),
  roles: IsStringList(),
});
export type SimpleUser = z.infer<typeof SimpleUserSchema>;

export const EUserSchema = z.object({
  id: IsEntityID(),
  username: IsUsername(),
  roles: IsStringList(),
  hashedPassword: z.undefined(),
});
export type EUser = z.infer<typeof EUserSchema>;

// What anyone may know about a user, like the uploader of an image
export const EPublicUserSchema = EUserSchema.pick({ id: true, username: true });
export type EPublicUser = z.infer<typeof EPublicUserSchema>;
