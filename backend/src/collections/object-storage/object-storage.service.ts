import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ImageEntryVariant } from 'picsur-shared/dist/dto/image-entry-variant.enum';
import {
  AsyncFailable,
  Fail,
  FT,
  HasFailed,
} from 'picsur-shared/dist/types/failable';
import {
  S3StorageConfig,
  StorageConfigService,
  StorageDriver,
} from '../../config/early/storage.config.service.js';

export interface StoredObject {
  key: string;
  lastModified: Date;
}

// DeleteObjects accepts at most this many keys per request
const DELETE_BATCH_SIZE = 1000;

// Objects are laid out per image, so everything belonging to an image lives
// under one prefix:
//   <prefix>images/<image id>/<variant>
//   <prefix>images/<image id>/derivatives/<key>
const IMAGES_DIR = 'images/';

// Stores image data in an S3 compatible bucket. The database keeps track of
// which object belongs to which image, so this only has to deal with keys.
@Injectable()
export class ObjectStorageService implements OnApplicationShutdown {
  private readonly logger = new Logger(ObjectStorageService.name);

  private readonly config: S3StorageConfig | null;
  private readonly client: S3Client | null;

  // Whether new image data is written to the bucket instead of the database
  public readonly isWriteTarget: boolean;

  constructor(storageConfig: StorageConfigService) {
    this.config = storageConfig.getS3Config();
    this.isWriteTarget = storageConfig.getDriver() === StorageDriver.S3;
    this.client = this.config === null ? null : CreateS3Client(this.config);
  }

  // After the http server stopped, so requests in progress can finish
  onApplicationShutdown() {
    this.client?.destroy();
  }

  public get isConfigured(): boolean {
    return this.client !== null;
  }

  public fileKey(imageId: string, variant: ImageEntryVariant): string {
    return `${this.prefix}${IMAGES_DIR}${imageId}/${variant}`;
  }

  public derivativeKey(imageId: string, key: string): string {
    return `${this.prefix}${IMAGES_DIR}${imageId}/derivatives/${key}`;
  }

  // Makes sure the bucket is usable, and creates it when it does not exist
  public async ensureBucket(): AsyncFailable<true> {
    const { client, config } = this.assertConfigured();

    try {
      await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
      return true;
    } catch (e) {
      if (!IsNotFound(e)) {
        return Fail(
          FT.Network,
          `Can not access bucket "${config.bucket}"`,
          DescribeS3Error(e),
        );
      }
    }

    this.logger.log(`Bucket "${config.bucket}" does not exist, creating it`);
    try {
      await client.send(new CreateBucketCommand({ Bucket: config.bucket }));
      return true;
    } catch (e) {
      return Fail(
        FT.Network,
        `Bucket "${config.bucket}" does not exist and could not be created`,
        DescribeS3Error(e),
      );
    }
  }

  public async put(
    key: string,
    data: Buffer,
    contentType: string,
  ): AsyncFailable<true> {
    const { client, config } = this.assertConfigured();

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: data,
          ContentType: contentType,
          ContentLength: data.length,
        }),
      );
      return true;
    } catch (e) {
      return Fail(FT.Network, 'Could not store image', DescribeS3Error(e));
    }
  }

  public async get(key: string): AsyncFailable<Buffer> {
    const { client, config } = this.assertConfigured();

    try {
      const result = await client.send(
        new GetObjectCommand({ Bucket: config.bucket, Key: key }),
      );
      if (!result.Body) return Fail(FT.NotFound, 'Image not found');
      return Buffer.from(await result.Body.transformToByteArray());
    } catch (e) {
      if (IsNotFound(e)) {
        return Fail(FT.NotFound, 'Image not found', `Missing object ${key}`);
      }
      return Fail(FT.Network, 'Could not load image', DescribeS3Error(e));
    }
  }

  // Deletes the given objects, keys that do not exist are ignored
  public async delete(keys: string[]): AsyncFailable<true> {
    if (keys.length === 0) return true;
    const { client, config } = this.assertConfigured();

    for (let i = 0; i < keys.length; i += DELETE_BATCH_SIZE) {
      const batch = keys.slice(i, i + DELETE_BATCH_SIZE);
      try {
        const result = await client.send(
          new DeleteObjectsCommand({
            Bucket: config.bucket,
            Delete: {
              Objects: batch.map((Key) => ({ Key })),
              Quiet: true,
            },
          }),
        );
        const errors = (result.Errors ?? []).filter(
          (error) => error.Code !== 'NoSuchKey',
        );
        if (errors.length > 0) {
          return Fail(
            FT.Network,
            'Could not delete images',
            `Failed to delete ${errors.length} objects, first error: ${errors[0].Code} ${errors[0].Message}`,
          );
        }
      } catch (e) {
        return Fail(FT.Network, 'Could not delete images', DescribeS3Error(e));
      }
    }

    return true;
  }

  // Deletes everything stored for the given images
  public async deleteImages(imageIds: string[]): AsyncFailable<true> {
    for (const imageId of imageIds) {
      const objects = await this.listImageObjects(imageId);
      if (HasFailed(objects)) return objects;

      const deleted = await this.delete(objects.map((object) => object.key));
      if (HasFailed(deleted)) return deleted;
    }
    return true;
  }

  // Lists everything stored for an image
  public async listImageObjects(
    imageId: string,
  ): AsyncFailable<StoredObject[]> {
    return this.list(`${this.prefix}${IMAGES_DIR}${imageId}/`);
  }

  // Lists the ids of all images that have objects in the bucket
  public async listImageIds(): AsyncFailable<string[]> {
    const { client, config } = this.assertConfigured();
    const imagesPrefix = `${this.prefix}${IMAGES_DIR}`;
    const ids: string[] = [];

    try {
      let token: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({
            Bucket: config.bucket,
            Prefix: imagesPrefix,
            Delimiter: '/',
            ContinuationToken: token,
          }),
        );
        for (const prefix of page.CommonPrefixes ?? []) {
          if (!prefix.Prefix) continue;
          ids.push(prefix.Prefix.slice(imagesPrefix.length).replace(/\/$/, ''));
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
    } catch (e) {
      return Fail(FT.Network, 'Could not list images', DescribeS3Error(e));
    }

    return ids;
  }

  private async list(prefix: string): AsyncFailable<StoredObject[]> {
    const { client, config } = this.assertConfigured();
    const objects: StoredObject[] = [];

    try {
      let token: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({
            Bucket: config.bucket,
            Prefix: prefix,
            ContinuationToken: token,
          }),
        );
        for (const object of page.Contents ?? []) {
          if (!object.Key) continue;
          objects.push({
            key: object.Key,
            lastModified: object.LastModified ?? new Date(0),
          });
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
    } catch (e) {
      return Fail(FT.Network, 'Could not list images', DescribeS3Error(e));
    }

    return objects;
  }

  private get prefix(): string {
    return this.config?.prefix ?? '';
  }

  private assertConfigured(): { client: S3Client; config: S3StorageConfig } {
    if (this.client === null || this.config === null) {
      // Only happens when the database refers to objects while no bucket is
      // configured anymore
      throw Fail(
        FT.Internal,
        'Image storage is not configured',
        'Image data is stored in S3, but no bucket is configured',
      );
    }
    return { client: this.client, config: this.config };
  }
}

function CreateS3Client(
  config: S3StorageConfig,
  // Give up quickly instead of retrying, for trying out settings
  quick = false,
): S3Client {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials:
      config.accessKeyId && config.secretAccessKey
        ? {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
          }
        : undefined,
    // Newer SDK versions add CRC checksums to every upload by default,
    // which many S3 compatible services do not understand
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    ...(quick
      ? {
          maxAttempts: 1,
          requestHandler: {
            connectionTimeout: 5000,
            requestTimeout: 10000,
            throwOnRequestTimeout: true,
          },
        }
      : {}),
  });
}

function IsNotFound(e: unknown): boolean {
  if (e instanceof S3ServiceException) {
    return (
      e.name === 'NoSuchKey' ||
      e.name === 'NotFound' ||
      e.name === 'NoSuchBucket' ||
      e.$metadata?.httpStatusCode === 404
    );
  }
  return false;
}

function DescribeS3Error(e: unknown): string {
  if (e instanceof S3ServiceException) {
    const status = `HTTP ${e.$metadata?.httpStatusCode}`;
    // Errors to HEAD requests have no body to take a name or message from
    const known = (text: string | undefined) =>
      text && text !== 'Unknown' && text !== 'UnknownError' ? text : null;
    const name = known(e.name);
    const message = known(e.message);
    return (
      (name ? `${name} (${status})` : status) + (message ? `: ${message}` : '')
    );
  }
  // Connecting to a name with several addresses fails with one per address
  if (e instanceof AggregateError && e.errors.length > 0) {
    return e.errors.map(DescribeS3Error).join(', ');
  }
  if (e instanceof Error) return e.message || e.name;
  return String(e);
}

function S3ErrorHint(e: unknown): string {
  if (!(e instanceof S3ServiceException)) return '';
  switch (e.$metadata?.httpStatusCode) {
    case 301:
      return '. The bucket is in another region.';
    case 403:
      return '. Check the access key, and that it may use this bucket.';
    default:
      return '';
  }
}

// Checks that images can be stored with the given settings, before they are
// used. Creates the bucket when it does not exist yet, like Picsur does when
// it starts.
export async function TestS3Storage(
  config: S3StorageConfig,
): AsyncFailable<{ created: boolean }> {
  const client = CreateS3Client(config, true);
  const bucket = config.bucket;
  // The reasons are shown on the settings page, where the details help
  const failure = (message: string, e: unknown) =>
    Fail(FT.Network, `${message}: ${DescribeS3Error(e)}${S3ErrorHint(e)}`);

  try {
    let created = false;
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch (e) {
      if (!IsNotFound(e)) {
        return failure(`Can not access bucket "${bucket}"`, e);
      }
      try {
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
        created = true;
      } catch (e) {
        return failure(
          `Bucket "${bucket}" does not exist and could not be created`,
          e,
        );
      }
    }

    const key = `${config.prefix}picsur-test-${randomUUID()}`;
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: 'Picsur checks that it can store images here',
          ContentType: 'text/plain',
        }),
      );
    } catch (e) {
      return failure(`Can not store files in bucket "${bucket}"`, e);
    }
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    } catch (e) {
      return failure(`Can not delete files in bucket "${bucket}"`, e);
    }

    return { created };
  } finally {
    client.destroy();
  }
}
