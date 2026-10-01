import { z } from 'zod';
import { IsHttpUrl } from '../validators/url.validator.js';

// Settings of the server itself, which take effect when Picsur (re)starts.
// Each can also be set with the environment variable of the same name,
// PICSUR_ followed by the key in capitals, which applies when nothing is
// saved for it on the settings page.
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
  TrustProxy = 'trust_proxy',

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
}
export const ServerSettingList: ServerSetting[] = Object.values(ServerSetting);

// Never shown once set
export const SecretServerSettings: ServerSetting[] = [
  ServerSetting.S3SecretAccessKey,
  ServerSetting.OidcClientSecret,
];

// Where image data is kept, changing these makes what is stored there
// unreachable
export const StorageLocationSettings: ServerSetting[] = [
  ServerSetting.StoragePath,
  ServerSetting.S3Endpoint,
  ServerSetting.S3Bucket,
  ServerSetting.S3Prefix,
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

const Bool = z.enum(['true', 'false']);
// Characters a scope may have, RFC 6749 section 3.3
const ScopeToken = /^[\x21\x23-\x5b\x5d-\x7e]+$/;

// All values are strings, like environment variables
export const ServerSettingValidators: {
  [key in ServerSetting]: z.ZodType<string>;
} = {
  [ServerSetting.StorageDriver]: z.enum(['database', 's3', 'filesystem']),
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
};
