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
    helpText: 'Like /picsur/images',
  },
  [ServerSetting.S3Endpoint]: {
    name: 'Endpoint',
    helpText: 'Leave empty for Amazon S3',
  },
  [ServerSetting.S3Region]: { name: 'Region' },
  [ServerSetting.S3Bucket]: { name: 'Bucket' },
  [ServerSetting.S3Prefix]: {
    name: 'Prefix',
    helpText: 'Optional path in the bucket, like picsur/',
  },
  [ServerSetting.S3ForcePathStyle]: {
    name: 'Path style addressing',
    helpText: 'Needed by MinIO and most self hosted services',
  },
  [ServerSetting.S3AccessKeyId]: { name: 'Access key id' },
  [ServerSetting.S3SecretAccessKey]: { name: 'Secret access key' },

  [ServerSetting.MaxFileSize]: { name: 'Maximum upload size (MB)' },
  [ServerSetting.MaxConcurrentConversions]: { name: 'Conversions at once' },
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
    helpText: '0 keeps them',
  },
  [ServerSetting.GuestUploadExpiry]: {
    name: 'Guest uploads expire after',
    helpText: 'At the latest, for visitors who are not logged in. 0 keeps them',
  },
  [ServerSetting.TrustProxy]: {
    name: 'Trusted proxies',
    helpText:
      'Comma separated addresses or ranges, true for any, false for none',
  },
  [ServerSetting.HostOverride]: {
    name: 'Public address',
    helpText: "Leave empty to use the browser's address",
  },

  [ServerSetting.OidcIssuer]: {
    name: 'Issuer',
    helpText: 'Like https://auth.example.com',
  },
  [ServerSetting.OidcClientId]: { name: 'Client id' },
  [ServerSetting.OidcClientSecret]: { name: 'Client secret' },
  [ServerSetting.OidcScope]: { name: 'Scopes' },
  [ServerSetting.OidcName]: {
    name: 'Provider name',
    helpText: 'Shown on the login button',
  },
  [ServerSetting.OidcUsernameClaim]: { name: 'Username claim' },
  [ServerSetting.OidcAutoRegister]: {
    name: 'Create accounts for new users',
    helpText: 'Anyone who can log in at the provider gets an account',
  },
  [ServerSetting.OidcAutoLaunch]: {
    name: 'Go to the provider right away',
    helpText: '/user/login?local still shows the login page',
  },
  [ServerSetting.PasswordLogin]: {
    name: 'Password login',
    helpText: 'To turn it back on: settings reset password_login',
  },
  [ServerSetting.JwtExpiry]: { name: 'Logins last' },
  [ServerSetting.BCryptStrength]: { name: 'Password hashing strength' },

  [ServerSetting.TrackingUrl]: { name: 'Ackee server' },
  [ServerSetting.TrackingId]: { name: 'Ackee website id' },

  [ServerSetting.Verbose]: {
    name: 'Verbose logging',
    helpText: 'Can include sensitive data',
  },
};

// What can only be set with environment variables
export const EnvironmentOptionUI: Record<string, string> = {
  PICSUR_HOST: 'Listens on',
  PICSUR_PORT: 'Port',
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
