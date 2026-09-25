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
      'How many images are converted or edited at the same time, others wait for their turn. Defaults to the number of CPU cores.',
  },
  [ServerSetting.ConversionRateLimit]: {
    name: 'Conversions per visitor per minute',
    helpText:
      'How many new sizes or formats one visitor may have made per minute. 0 turns the limit off.',
  },
  [ServerSetting.TrustProxy]: {
    name: 'Trusted proxies',
    helpText:
      'Which reverse proxies may pass on the address of visitors, for rate limiting. Addresses and ranges separated by commas, or true for any and false for none.',
  },
};
