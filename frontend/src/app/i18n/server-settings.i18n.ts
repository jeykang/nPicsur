import { ServerSetting } from 'picsur-shared/dist/dto/server-settings.dto';

// A hint only when the name alone does not say enough: a format, a unit, or a
// consequence worth knowing before changing it
export const ServerSettingUI: {
  [key in ServerSetting]: {
    name: string;
    helpText?: string;
  };
} = {
  [ServerSetting.StorageDriver]: { name: 'Store new images in' },
  [ServerSetting.StoragePath]: {
    name: 'Directory',
    helpText: 'Absolute path, e.g. /picsur/images',
  },
  [ServerSetting.S3Endpoint]: {
    name: 'Endpoint',
    helpText: 'Leave empty for Amazon S3',
  },
  [ServerSetting.S3Region]: { name: 'Region' },
  [ServerSetting.S3Bucket]: { name: 'Bucket' },
  [ServerSetting.S3Prefix]: {
    name: 'Prefix',
    helpText: 'Optional path within the bucket, e.g. picsur/',
  },
  [ServerSetting.S3ForcePathStyle]: {
    name: 'Path style addressing',
    helpText: 'Required by MinIO and most self-hosted services',
  },
  [ServerSetting.S3AccessKeyId]: { name: 'Access key ID' },
  [ServerSetting.S3SecretAccessKey]: { name: 'Secret access key' },

  [ServerSetting.MaxFileSize]: { name: 'Maximum upload size (MB)' },
  [ServerSetting.MaxConcurrentConversions]: { name: 'Concurrent conversions' },
  [ServerSetting.ConversionRateLimit]: {
    name: 'Conversions per visitor per minute',
    helpText: '0 for no limit',
  },
  [ServerSetting.ConversionTimeLimit]: { name: 'Conversion time limit' },
  [ServerSetting.ConversionMemoryLimit]: {
    name: 'Conversion memory limit (MB)',
  },
  [ServerSetting.AllowEditing]: {
    name: 'Allow customizing images',
    helpText: 'Resizing, rotating and other changes in the image URL',
  },
  [ServerSetting.RemoveDerivativesAfter]: {
    name: 'Keep converted versions for',
    helpText: '0 disables cleanup',
  },
  [ServerSetting.GuestUploadExpiry]: {
    name: 'Guest uploads expire after',
    helpText: 'Maximum lifetime for anonymous uploads. 0 sets no limit',
  },
  [ServerSetting.TrustProxy]: {
    name: 'Trusted proxies',
    helpText:
      'Comma-separated addresses or ranges; true trusts all proxies, false trusts none',
  },
  [ServerSetting.HostOverride]: {
    name: 'Public address',
    helpText:
      "Include the base path, if any. Leave empty to use the browser's address",
  },

  [ServerSetting.OidcIssuer]: {
    name: 'Issuer',
    helpText: 'E.g. https://auth.example.com',
  },
  [ServerSetting.OidcClientId]: { name: 'Client ID' },
  [ServerSetting.OidcClientSecret]: { name: 'Client secret' },
  [ServerSetting.OidcScope]: { name: 'Scopes' },
  [ServerSetting.OidcName]: {
    name: 'Provider name',
    helpText: 'Shown on the login button',
  },
  [ServerSetting.OidcUsernameClaim]: { name: 'Username claim' },
  [ServerSetting.OidcAutoRegister]: {
    name: 'Create accounts for new users',
    helpText:
      'Automatically register anyone who can log in through this provider',
  },
  [ServerSetting.OidcAutoLaunch]: {
    name: 'Redirect to provider automatically',
    helpText: '/user/login?local still shows the login page',
  },
  [ServerSetting.PasswordLogin]: {
    name: 'Password login',
    helpText: 'To turn it back on: settings reset password_login',
  },
  [ServerSetting.JwtExpiry]: { name: 'Login expiry' },
  [ServerSetting.BCryptStrength]: { name: 'Password hashing strength' },

  [ServerSetting.TrackingUrl]: { name: 'Ackee server' },
  [ServerSetting.TrackingId]: { name: 'Ackee website ID' },

  [ServerSetting.Verbose]: {
    name: 'Verbose logging',
    helpText: 'Can include sensitive data',
  },
};

// What can only be set with environment variables
export const EnvironmentOptionUI: Record<string, string> = {
  PICSUR_HOST: 'Listen address',
  PICSUR_PORT: 'Port',
  PICSUR_BASE_PATH: 'Served under',
  PICSUR_DB_HOST: 'Database server',
  PICSUR_DB_PORT: 'Database port',
  PICSUR_DB_DATABASE: 'Database',
  PICSUR_DB_USERNAME: 'Database user',
  PICSUR_DB_PASSWORD: 'Database password',
  PICSUR_JWT_SECRET: 'Login signing secret',
  PICSUR_ENCRYPTION_KEY: 'Encryption key',
  PICSUR_STATIC_FRONTEND_ROOT: 'Frontend files',
  PICSUR_PRODUCTION: 'Production mode',
  PICSUR_DEMO: 'Demo mode',
  PICSUR_DEMO_INTERVAL: 'Demo resets every (ms)',
};
