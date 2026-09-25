import { z } from 'zod';
import { IsHttpUrl } from '../validators/url.validator.js';

// Settings of the server itself, which take effect when Picsur (re)starts.
// Each can also be set with the environment variable of the same name,
// PICSUR_ followed by the key in capitals, which then takes precedence.
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
}
export const ServerSettingList: ServerSetting[] = Object.values(ServerSetting);

// Never shown once set
export const SecretServerSettings: ServerSetting[] = [
  ServerSetting.S3SecretAccessKey,
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
  [ServerSetting.S3ForcePathStyle]: z.enum(['true', 'false']),
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
};
