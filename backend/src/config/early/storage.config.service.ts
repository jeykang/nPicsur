import { Injectable, Logger } from '@nestjs/common';
import { ServerSetting } from 'picsur-shared/dist/dto/server-settings.dto';
import { ParseBool } from 'picsur-shared/dist/util/parse-simple';
import { DefaultS3Region, GetServerSetting } from '../server-settings.js';

export enum StorageDriver {
  // Image data is stored in the database, next to everything else
  Database = 'database',
  // Image data is stored in an S3 compatible bucket
  S3 = 's3',
}

export interface S3StorageConfig {
  bucket: string;
  region: string;
  // For S3 compatible services other than AWS, e.g. https://minio.local:9000
  endpoint?: string;
  // Access the bucket as https://endpoint/bucket instead of
  // https://bucket.endpoint, which many self hosted services need
  forcePathStyle: boolean;
  // When left out, the AWS SDK looks for credentials itself (AWS_* variables,
  // instance roles, ...)
  accessKeyId?: string;
  secretAccessKey?: string;
  // Prepended to every object key, to share a bucket with other things
  prefix: string;
}

export interface StorageConfig {
  driver: StorageDriver;
  // The bucket is used for reading whenever it is configured, even when new
  // images go to the database. That way nothing becomes unreachable when
  // switching drivers before everything is migrated.
  s3: S3StorageConfig | null;
}

// Works out the storage from the server settings, and throws when they do not
// fit together
export function BuildStorageConfig(
  get: (key: ServerSetting) => string | undefined,
): StorageConfig {
  const value = (
    get(ServerSetting.StorageDriver) ?? StorageDriver.Database
  ).toLowerCase();
  if (!Object.values<string>(StorageDriver).includes(value)) {
    throw new Error(
      `The storage driver (PICSUR_STORAGE_DRIVER) must be one of: ${Object.values(
        StorageDriver,
      ).join(', ')}`,
    );
  }
  const driver = value as StorageDriver;

  const s3 = BuildS3Config(get);
  if (driver === StorageDriver.S3 && s3 === null) {
    throw new Error(
      'Storing images in S3 needs a bucket (PICSUR_S3_BUCKET) to store them in',
    );
  }
  return { driver, s3 };
}

function BuildS3Config(
  get: (key: ServerSetting) => string | undefined,
): S3StorageConfig | null {
  const bucket = get(ServerSetting.S3Bucket);
  if (!bucket) return null;

  const accessKeyId = get(ServerSetting.S3AccessKeyId);
  const secretAccessKey = get(ServerSetting.S3SecretAccessKey);
  if (!!accessKeyId !== !!secretAccessKey) {
    throw new Error(
      'Set both the S3 access key id and secret access key (PICSUR_S3_ACCESS_KEY_ID and PICSUR_S3_SECRET_ACCESS_KEY), or neither',
    );
  }

  let prefix = get(ServerSetting.S3Prefix) ?? '';
  // Keys never start with a slash, and a prefix is always a "directory"
  prefix = prefix.replace(/^\/+/, '');
  if (prefix !== '' && !prefix.endsWith('/')) prefix += '/';

  return {
    bucket,
    region: get(ServerSetting.S3Region) ?? DefaultS3Region,
    endpoint: get(ServerSetting.S3Endpoint),
    forcePathStyle: ParseBool(get(ServerSetting.S3ForcePathStyle), false),
    accessKeyId,
    secretAccessKey,
    prefix,
  };
}

// Whether two storage configurations keep image data in the same place
export function SameStorageLocation(
  a: S3StorageConfig | null,
  b: S3StorageConfig | null,
): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.bucket === b.bucket &&
    (a.endpoint ?? '') === (b.endpoint ?? '') &&
    a.prefix === b.prefix
  );
}

@Injectable()
export class StorageConfigService {
  private readonly logger = new Logger(StorageConfigService.name);
  private readonly config: StorageConfig;

  constructor() {
    this.config = BuildStorageConfig(GetServerSetting);

    this.logger.log('Storage driver: ' + this.config.driver);
    const s3 = this.config.s3;
    if (s3 !== null) {
      this.logger.log(
        `S3 bucket: ${s3.bucket}` +
          (s3.endpoint ? ` at ${s3.endpoint}` : ` in ${s3.region}`) +
          (s3.prefix ? ` with prefix "${s3.prefix}"` : ''),
      );
    }
  }

  public getDriver(): StorageDriver {
    return this.config.driver;
  }

  public getS3Config(): S3StorageConfig | null {
    return this.config.s3;
  }
}
