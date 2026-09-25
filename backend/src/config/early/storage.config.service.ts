import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ParseBool, ParseString } from 'picsur-shared/dist/util/parse-simple';
import { EnvPrefix } from '../config.static.js';

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

@Injectable()
export class StorageConfigService {
  private readonly logger = new Logger(StorageConfigService.name);

  constructor(private readonly configService: ConfigService) {
    const driver = this.getDriver();
    this.logger.log('Storage driver: ' + driver);
    const s3 = this.getS3Config();
    if (s3 !== null) {
      this.logger.log(
        `S3 bucket: ${s3.bucket}` +
          (s3.endpoint ? ` at ${s3.endpoint}` : ` in ${s3.region}`) +
          (s3.prefix ? ` with prefix "${s3.prefix}"` : ''),
      );
    }
    if (driver === StorageDriver.S3 && s3 === null) {
      throw new Error(
        `${EnvPrefix}S3_BUCKET is required when using the s3 storage driver`,
      );
    }
  }

  public getDriver(): StorageDriver {
    const value = (
      this.getString('STORAGE_DRIVER') ?? StorageDriver.Database
    ).toLowerCase();

    if (!Object.values<string>(StorageDriver).includes(value)) {
      throw new Error(
        `${EnvPrefix}STORAGE_DRIVER must be one of: ${Object.values(
          StorageDriver,
        ).join(', ')}`,
      );
    }
    return value as StorageDriver;
  }

  // The bucket is used for reading whenever it is configured, even when new
  // images go to the database. That way nothing becomes unreachable when
  // switching drivers before everything is migrated.
  public getS3Config(): S3StorageConfig | null {
    const bucket = this.getString('S3_BUCKET');
    if (!bucket) return null;

    const accessKeyId = this.getString('S3_ACCESS_KEY_ID');
    const secretAccessKey = this.getString('S3_SECRET_ACCESS_KEY');
    if (!!accessKeyId !== !!secretAccessKey) {
      throw new Error(
        `Set both ${EnvPrefix}S3_ACCESS_KEY_ID and ${EnvPrefix}S3_SECRET_ACCESS_KEY, or neither`,
      );
    }

    let prefix = this.getString('S3_PREFIX') ?? '';
    // Keys never start with a slash, and a prefix is always a "directory"
    prefix = prefix.replace(/^\/+/, '');
    if (prefix !== '' && !prefix.endsWith('/')) prefix += '/';

    return {
      bucket,
      region: this.getString('S3_REGION') ?? 'us-east-1',
      endpoint: this.getString('S3_ENDPOINT'),
      forcePathStyle: ParseBool(
        this.configService.get(`${EnvPrefix}S3_FORCE_PATH_STYLE`),
        false,
      ),
      accessKeyId,
      secretAccessKey,
      prefix,
    };
  }

  private getString(name: string): string | undefined {
    const value = ParseString(this.configService.get(`${EnvPrefix}${name}`));
    if (value === null) return undefined;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }
}
