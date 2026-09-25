import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
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
export class ObjectStorageService implements OnModuleDestroy {
  private readonly logger = new Logger(ObjectStorageService.name);

  private readonly config: S3StorageConfig | null;
  private readonly client: S3Client | null;

  // Whether new image data is written to the bucket instead of the database
  public readonly isWriteTarget: boolean;

  constructor(storageConfig: StorageConfigService) {
    this.config = storageConfig.getS3Config();
    this.isWriteTarget = storageConfig.getDriver() === StorageDriver.S3;
    this.client = this.config === null ? null : this.createClient(this.config);
  }

  onModuleDestroy() {
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
      if (!this.isNotFound(e)) {
        return Fail(
          FT.Network,
          `Can not access bucket "${config.bucket}"`,
          this.describeError(e),
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
        this.describeError(e),
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
      return Fail(FT.Network, 'Could not store image', this.describeError(e));
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
      if (this.isNotFound(e)) {
        return Fail(FT.NotFound, 'Image not found', `Missing object ${key}`);
      }
      return Fail(FT.Network, 'Could not load image', this.describeError(e));
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
        return Fail(
          FT.Network,
          'Could not delete images',
          this.describeError(e),
        );
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
      return Fail(FT.Network, 'Could not list images', this.describeError(e));
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
      return Fail(FT.Network, 'Could not list images', this.describeError(e));
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
        'Image data is stored in S3, but PICSUR_S3_BUCKET is not set',
      );
    }
    return { client: this.client, config: this.config };
  }

  private createClient(config: S3StorageConfig): S3Client {
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
    });
  }

  private isNotFound(e: unknown): boolean {
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

  private describeError(e: unknown): string {
    if (e instanceof S3ServiceException) {
      return `${e.name} (HTTP ${e.$metadata?.httpStatusCode}): ${e.message}`;
    }
    return String(e);
  }
}
