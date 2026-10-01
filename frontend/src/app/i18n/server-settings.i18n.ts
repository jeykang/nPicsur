import { ServerSetting } from 'picsur-shared/dist/dto/server-settings.dto';

export const ServerSettingUI: {
  [key in ServerSetting]: {
    name: string;
    helpText: string;
  };
} = {
  [ServerSetting.StorageDriver]: {
    name: 'Store new images in',
    helpText:
      'Images that are already stored stay where they are, until they are moved.',
  },
  [ServerSetting.StoragePath]: {
    name: 'Directory',
    helpText:
      'Where the images are stored, like /picsur/images. In Docker, mount a volume there. Created when it does not exist yet.',
  },
  [ServerSetting.S3Endpoint]: {
    name: 'Endpoint',
    helpText:
      'Address of the S3 compatible service, like http://minio:9000. Leave empty for Amazon S3.',
  },
  [ServerSetting.S3Region]: {
    name: 'Region',
    helpText: 'Most self hosted services accept any region.',
  },
  [ServerSetting.S3Bucket]: {
    name: 'Bucket',
    helpText: 'Created when it does not exist yet.',
  },
  [ServerSetting.S3Prefix]: {
    name: 'Prefix',
    helpText:
      'Stores everything under this path in the bucket, to share it with other things.',
  },
  [ServerSetting.S3ForcePathStyle]: {
    name: 'Path style addressing',
    helpText:
      'Reach the bucket at endpoint/bucket instead of bucket.endpoint. MinIO and most other self hosted services need this.',
  },
  [ServerSetting.S3AccessKeyId]: {
    name: 'Access key id',
    helpText:
      'Leave the access key and secret empty to use the credentials of the environment, like AWS_ACCESS_KEY_ID or an instance role.',
  },
  [ServerSetting.S3SecretAccessKey]: {
    name: 'Secret access key',
    helpText: 'It is never shown again once it is saved.',
  },

  [ServerSetting.MaxFileSize]: {
    name: 'Maximum upload size (MB)',
    helpText: 'Larger uploads are refused.',
  },
  [ServerSetting.MaxConcurrentConversions]: {
    name: 'Conversions at once',
    helpText:
      'How many images are converted or customized at the same time, others wait for their turn. Defaults to the number of CPU cores.',
  },
  [ServerSetting.ConversionRateLimit]: {
    name: 'Conversions per visitor per minute',
    helpText:
      'How many new sizes or formats one visitor may have made per minute. 0 turns the limit off.',
  },
  [ServerSetting.ConversionTimeLimit]: {
    name: 'Conversion time limit',
    helpText:
      'How long converting or customizing one image may take, like 15s. Slow computers might need more for large images.',
  },
  [ServerSetting.ConversionMemoryLimit]: {
    name: 'Conversion memory limit (MB)',
    helpText:
      'How much memory converting or customizing one image may use. Only very large images need more.',
  },
  [ServerSetting.AllowEditing]: {
    name: 'Allow customizing images',
    helpText:
      'Lets the address of an image ask for another size, a rotation or other changes, which takes time to convert. Other formats can always be asked for.',
  },
  [ServerSetting.RemoveDerivativesAfter]: {
    name: 'Keep converted versions for',
    helpText:
      'Converted versions of images that were not asked for this long are removed, like 7d, and made again when needed. Shorter saves space, but costs more conversions. 0 keeps them.',
  },
  [ServerSetting.TrustProxy]: {
    name: 'Trusted proxies',
    helpText:
      'Which reverse proxies may pass on the address of visitors, for rate limiting. Addresses, ranges and the names loopback, linklocal and uniquelocal, separated by commas, or true for any and false for none.',
  },
  [ServerSetting.HostOverride]: {
    name: 'Public address',
    helpText:
      'Where Picsur is reached, like https://images.example.com. Links to images use it, and the provider sends users back to it after logging in. Leave empty to use the address in the browser.',
  },

  [ServerSetting.OidcIssuer]: {
    name: 'Issuer',
    helpText:
      'Of the provider, like https://auth.example.com. Exactly what the provider calls itself, or the address of its discovery document.',
  },
  [ServerSetting.OidcClientId]: {
    name: 'Client id',
    helpText: 'Of Picsur, as set up at the provider.',
  },
  [ServerSetting.OidcClientSecret]: {
    name: 'Client secret',
    helpText:
      'Of Picsur, as set up at the provider. It is never shown again once it is saved.',
  },
  [ServerSetting.OidcScope]: {
    name: 'Scopes',
    helpText: 'Asked for at the provider, separated by spaces.',
  },
  [ServerSetting.OidcName]: {
    name: 'Provider name',
    helpText: 'Of the provider, the login button says "Log in with" it.',
  },
  [ServerSetting.OidcUsernameClaim]: {
    name: 'Username claim',
    helpText:
      'The claim new users get their username from. Without it, their email address or name is used. Usernames only have letters and digits.',
  },
  [ServerSetting.OidcAutoRegister]: {
    name: 'Create accounts for new users',
    helpText:
      'Gives everyone who can log in at the provider an account here, the first time they log in. Otherwise only users who linked their login can log in with it.',
  },
  [ServerSetting.OidcAutoLaunch]: {
    name: 'Go to the provider right away',
    helpText:
      'Skips the login page. It can still be reached at /user/login?local.',
  },
  [ServerSetting.PasswordLogin]: {
    name: 'Password login',
    helpText:
      'Can only be turned off once you logged in with the provider yourself. Should the provider fail, "settings reset password_login" on the command line turns it on again, see the README.',
  },
  [ServerSetting.JwtExpiry]: {
    name: 'Logins last',
    helpText:
      'How long someone stays logged in without opening Picsur, like 7d or 12h. Opening it renews the login.',
  },
  [ServerSetting.BCryptStrength]: {
    name: 'Password hashing strength',
    helpText:
      'Makes passwords harder to find from a copy of the database, every step doubles the time logging in takes. Applies to passwords set from now on. Lower it on slow computers.',
  },

  [ServerSetting.TrackingUrl]: {
    name: 'Ackee server',
    helpText:
      'Address of an Ackee server to count visits with, like https://ackee.example.com. Visits are passed on through Picsur, with the address of the visitor in X-Forwarded-For.',
  },
  [ServerSetting.TrackingId]: {
    name: 'Ackee website id',
    helpText:
      'Of Picsur, as set up in Ackee. Visits are counted once both are set.',
  },

  [ServerSetting.Verbose]: {
    name: 'Verbose logging',
    helpText: 'Logs a lot more, which can include sensitive data.',
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
  PICSUR_JWT_SECRET: 'Secret logins are signed with',
  PICSUR_ENCRYPTION_KEY: 'Key saved secrets are encrypted with',
  PICSUR_STATIC_FRONTEND_ROOT: 'Frontend files',
  PICSUR_PRODUCTION: 'Production mode',
  PICSUR_DEMO: 'Demo mode',
  PICSUR_DEMO_INTERVAL: 'Demo resets every (ms)',
};
