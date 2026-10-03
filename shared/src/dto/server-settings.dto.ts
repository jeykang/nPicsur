import ms from 'ms';
import { z } from 'zod';
import { IsEntityID } from '../validators/entity-id.validator.js';
import { StorageDriverSchema } from './storage-driver.enum.js';
import { IsHttpUrl } from '../validators/url.validator.js';

// The settings of Picsur, changed on the settings page. Each can also be set
// with the environment variable of the same name, PICSUR_ followed by the key
// in capitals, which applies when nothing is saved for it on the page. Most
// take effect when Picsur (re)starts, those in LiveServerSettings right away.
export enum ServerSetting {
  StorageDriver = 'storage_driver',
  StoragePath = 'storage_path',
  S3Endpoint = 's3_endpoint',
  S3Region = 's3_region',
  S3Bucket = 's3_bucket',
  S3Prefix = 's3_prefix',
  S3ForcePathStyle = 's3_force_path_style',
  S3AccessKeyId = 's3_access_key_id',
  S3SecretAccessKey = 's3_secret_access_key',

  MaxFileSize = 'max_file_size',
  MaxConcurrentConversions = 'max_concurrent_conversions',
  ConversionRateLimit = 'conversion_rate_limit',
  ConversionTimeLimit = 'conversion_time_limit',
  ConversionMemoryLimit = 'conversion_memory_limit',
  AllowEditing = 'allow_editing',
  RemoveDerivativesAfter = 'remove_derivatives_after',
  // Uploads of visitors who are not logged in expire after this at the
  // latest, 0 keeps them
  GuestUploadExpiry = 'guest_upload_expiry',

  TrustProxy = 'trust_proxy',
  HostOverride = 'host_override',

  // Logging in with an OpenID Connect provider, which is set up when there is
  // an issuer and a client id
  OidcIssuer = 'oidc_issuer',
  OidcClientId = 'oidc_client_id',
  OidcClientSecret = 'oidc_client_secret',
  OidcScope = 'oidc_scope',
  OidcName = 'oidc_name',
  OidcUsernameClaim = 'oidc_username_claim',
  OidcAutoRegister = 'oidc_auto_register',
  OidcAutoLaunch = 'oidc_auto_launch',
  PasswordLogin = 'password_login',
  JwtExpiry = 'jwt_expiry',
  BCryptStrength = 'bcrypt_strength',

  // Counting visits with Ackee
  TrackingUrl = 'tracking_url',
  TrackingId = 'tracking_id',

  Verbose = 'verbose',
}
export const ServerSettingList: ServerSetting[] = Object.values(ServerSetting);

// Take effect when they are saved, the others when Picsur restarts
export const LiveServerSettings: ServerSetting[] = [
  ServerSetting.ConversionTimeLimit,
  ServerSetting.ConversionMemoryLimit,
  ServerSetting.AllowEditing,
  ServerSetting.RemoveDerivativesAfter,
  ServerSetting.GuestUploadExpiry,
  ServerSetting.HostOverride,
  ServerSetting.JwtExpiry,
  ServerSetting.BCryptStrength,
  ServerSetting.TrackingUrl,
  ServerSetting.TrackingId,
];

// Either true or false
export const BoolServerSettings: ServerSetting[] = [
  ServerSetting.S3ForcePathStyle,
  ServerSetting.AllowEditing,
  ServerSetting.OidcAutoRegister,
  ServerSetting.OidcAutoLaunch,
  ServerSetting.PasswordLogin,
  ServerSetting.Verbose,
];

// Never shown once set
export const SecretServerSettings: ServerSetting[] = [
  ServerSetting.S3SecretAccessKey,
  ServerSetting.OidcClientSecret,
];

export const StorageSettings: ServerSetting[] = [
  ServerSetting.StorageDriver,
  ServerSetting.StoragePath,
  ServerSetting.S3Endpoint,
  ServerSetting.S3Region,
  ServerSetting.S3Bucket,
  ServerSetting.S3Prefix,
  ServerSetting.S3ForcePathStyle,
  ServerSetting.S3AccessKeyId,
  ServerSetting.S3SecretAccessKey,
];

export const OidcSettings: ServerSetting[] = [
  ServerSetting.OidcIssuer,
  ServerSetting.OidcClientId,
  ServerSetting.OidcClientSecret,
  ServerSetting.OidcScope,
  ServerSetting.OidcName,
  ServerSetting.OidcUsernameClaim,
  ServerSetting.OidcAutoRegister,
  ServerSetting.OidcAutoLaunch,
];

export function ServerSettingEnvName(setting: ServerSetting): string {
  return 'PICSUR_' + setting.toUpperCase();
}

const PositiveInt = (max: number, min = 1) =>
  z
    .string()
    .regex(/^\d{1,12}$/, 'Should be a whole number')
    .refine((value) => {
      const number = Number(value);
      return number >= min && number <= max;
    }, `Should be between ${min} and ${max}`);

const IpOrRange =
  /^(\d{1,3}(\.\d{1,3}){3}|[0-9a-fA-F:]*:[0-9a-fA-F:.]*)(\/\d{1,3})?$/;
// Names for common ranges that the proxy handling understands
const NamedRanges = ['loopback', 'linklocal', 'uniquelocal'];

const Bool = z.enum(['true', 'false'], {
  errorMap: () => ({ message: 'Should be true or false' }),
});
// Characters a scope may have, RFC 6749 section 3.3
const ScopeToken = /^[\x21\x23-\x5b\x5d-\x7e]+$/;

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const DAY = 24 * 60 * MINUTE;

// A duration like 15s, 30m or 7d, in milliseconds
export function ParseDuration(value: string): number | undefined {
  try {
    const parsed = ms(value);
    return typeof parsed === 'number' && Number.isFinite(parsed)
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

const Duration = (min: number, max: number, message: string) =>
  z
    .string()
    .max(32)
    .refine((value) => {
      const parsed = ParseDuration(value);
      return parsed !== undefined && parsed >= min && parsed <= max;
    }, message);

// All values are strings, like environment variables
export const ServerSettingValidators: {
  [key in ServerSetting]: z.ZodType<string>;
} = {
  [ServerSetting.StorageDriver]: StorageDriverSchema,
  [ServerSetting.StoragePath]: z
    .string()
    .max(1024)
    .regex(/^\/[^\0\r\n]*$/, 'Should be a full path, like /picsur/images'),
  [ServerSetting.S3Endpoint]: IsHttpUrl(),
  [ServerSetting.S3Region]: z
    .string()
    .regex(/^[a-zA-Z0-9-]{1,64}$/, 'Invalid region'),
  [ServerSetting.S3Bucket]: z
    .string()
    .regex(
      /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/,
      'Bucket names are 3 to 63 lowercase letters, digits, dots and dashes',
    ),
  [ServerSetting.S3Prefix]: z
    .string()
    .max(256)
    .regex(/^[^\s\\]*$/, 'Invalid prefix'),
  [ServerSetting.S3ForcePathStyle]: Bool,
  [ServerSetting.S3AccessKeyId]: z
    .string()
    .regex(/^\S{1,256}$/, 'Invalid access key id'),
  [ServerSetting.S3SecretAccessKey]: z
    .string()
    .regex(/^\S{1,256}$/, 'Invalid secret access key'),

  [ServerSetting.MaxFileSize]: PositiveInt(100_000_000_000, 1024),
  [ServerSetting.MaxConcurrentConversions]: PositiveInt(256),
  [ServerSetting.ConversionRateLimit]: PositiveInt(1_000_000, 0),
  [ServerSetting.ConversionTimeLimit]: Duration(
    SECOND,
    10 * MINUTE,
    'Should be a duration between 1s and 10m, like 15s',
  ),
  [ServerSetting.ConversionMemoryLimit]: PositiveInt(65536, 16),
  [ServerSetting.AllowEditing]: Bool,
  // 0 keeps them
  [ServerSetting.RemoveDerivativesAfter]: z
    .literal('0')
    .or(
      Duration(
        MINUTE,
        Number.MAX_SAFE_INTEGER,
        'Should be 0, or a duration of at least 1m, like 7d',
      ),
    ),
  [ServerSetting.GuestUploadExpiry]: z
    .literal('0')
    .or(
      Duration(
        MINUTE,
        10 * 365 * DAY,
        'Should be 0, or a duration between 1m and 3650d, like 1d',
      ),
    ),
  [ServerSetting.TrustProxy]: z
    .string()
    .max(1024)
    .refine(
      (value) =>
        value === 'true' ||
        value === 'false' ||
        value
          .split(',')
          .map((entry) => entry.trim())
          .every(
            (entry) => IpOrRange.test(entry) || NamedRanges.includes(entry),
          ),
      'Should be true, false, or addresses and ranges separated by commas',
    ),
  [ServerSetting.HostOverride]: IsHttpUrl(),

  [ServerSetting.OidcIssuer]: IsHttpUrl(),
  [ServerSetting.OidcClientId]: z
    .string()
    .regex(/^\S{1,512}$/, 'Invalid client id'),
  [ServerSetting.OidcClientSecret]: z
    .string()
    .regex(/^\S{1,1024}$/, 'Invalid client secret'),
  [ServerSetting.OidcScope]: z
    .string()
    .max(1024)
    .refine(
      (value) => value.split(/ +/).every((scope) => ScopeToken.test(scope)),
      'Should be scopes separated by spaces',
    )
    .refine(
      (value) => value.split(/ +/).includes('openid'),
      'Should include openid',
    ),
  [ServerSetting.OidcName]: z
    .string()
    .regex(/^[^\x00-\x1f\x7f]{1,64}$/, 'Should be at most 64 characters'),
  [ServerSetting.OidcUsernameClaim]: z
    .string()
    .regex(/^\S{1,256}$/, 'Invalid claim name'),
  [ServerSetting.OidcAutoRegister]: Bool,
  [ServerSetting.OidcAutoLaunch]: Bool,
  [ServerSetting.PasswordLogin]: Bool,
  // Too short and nobody can stay logged in, the admin included
  [ServerSetting.JwtExpiry]: Duration(
    MINUTE,
    365 * DAY,
    'Should be a duration between 1m and 365d, like 7d',
  ),
  // Every step doubles the time logging in takes
  [ServerSetting.BCryptStrength]: PositiveInt(15, 4),

  [ServerSetting.TrackingUrl]: IsHttpUrl(),
  [ServerSetting.TrackingId]: IsEntityID(),

  [ServerSetting.Verbose]: Bool,
};
