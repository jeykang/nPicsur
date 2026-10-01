import { z } from 'zod';
import { EUserSchema } from '../../entities/user.entity.js';
import { createZodDto } from '../../util/create-zod-dto.js';
import { IsStringList } from '../../validators/string-list.validator.js';
import {
  IsPlainTextPwd,
  IsUsername,
} from '../../validators/user.validators.js';

// Api
const UserPassSchema = z.object({
  username: IsUsername(),
  password: IsPlainTextPwd(),
});

// UserLogin
export const UserLoginRequestSchema = UserPassSchema;
export class UserLoginRequest extends createZodDto(UserLoginRequestSchema) {}

export const UserLoginResponseSchema = z.object({
  jwt_token: z.string(),
});
export class UserLoginResponse extends createZodDto(UserLoginResponseSchema) {}

// UserRegister
export const UserRegisterRequestSchema = UserPassSchema;
export class UserRegisterRequest extends createZodDto(
  UserRegisterRequestSchema,
) {}

export const UserRegisterResponseSchema = EUserSchema;
export class UserRegisterResponse extends createZodDto(
  UserRegisterResponseSchema,
) {}

// UserChangePassword
export const UserChangePasswordRequestSchema = z.object({
  // Left out by users who have no password yet, as they log in with OpenID
  // Connect
  current_password: IsPlainTextPwd().optional(),
  new_password: IsPlainTextPwd(),
});
export class UserChangePasswordRequest extends createZodDto(
  UserChangePasswordRequestSchema,
) {}

// Changing the password logs out every session, this is a new token for the
// session that changed it
export const UserChangePasswordResponseSchema = UserLoginResponseSchema;
export class UserChangePasswordResponse extends createZodDto(
  UserChangePasswordResponseSchema,
) {}

// UserCheckName
export const UserCheckNameRequestSchema = z.object({
  username: IsUsername(),
});
export class UserCheckNameRequest extends createZodDto(
  UserCheckNameRequestSchema,
) {}

export const UserCheckNameResponseSchema = z.object({
  available: z.boolean(),
});
export class UserCheckNameResponse extends createZodDto(
  UserCheckNameResponseSchema,
) {}

// UserMe
export const UserMeResponseSchema = z.object({
  user: EUserSchema,
  token: z.string(),
});
export class UserMeResponse extends createZodDto(UserMeResponseSchema) {}

// UserMePermissions
export const UserMePermissionsResponseSchema = z.object({
  permissions: IsStringList(),
});
export class UserMePermissionsResponse extends createZodDto(
  UserMePermissionsResponseSchema,
) {}

// Logging in with an OpenID Connect provider

// Where to send the browser to log in at the provider, or to link a login
// there to the account
export const UserOidcStartResponseSchema = z.object({
  url: z.string(),
});
export class UserOidcStartResponse extends createZodDto(
  UserOidcStartResponseSchema,
) {}

export const UserOidcCallbackRequestSchema = z.object({
  // The url the provider sent the browser back to
  url: z.string().max(16384),
});
export class UserOidcCallbackRequest extends createZodDto(
  UserOidcCallbackRequestSchema,
) {}

export const UserOidcCallbackResponseSchema = z.object({
  // A session token after logging in, null after linking a login
  jwt_token: z.string().nullable(),
});
export class UserOidcCallbackResponse extends createZodDto(
  UserOidcCallbackResponseSchema,
) {}

// How the user logs in
export const UserLoginMethodsResponseSchema = z.object({
  // Whether the account has a password
  password: z.boolean(),
  // Null when logging in with a provider is not set up
  oidc: z
    .object({
      // Of the provider
      provider: z.string(),
      linked: z.boolean(),
      // What the provider calls the linked login
      name: z.string().nullable(),
    })
    .nullable(),
});
export class UserLoginMethodsResponse extends createZodDto(
  UserLoginMethodsResponseSchema,
) {}
