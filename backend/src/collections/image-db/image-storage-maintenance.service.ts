import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ImageEntryVariant } from 'picsur-shared/dist/dto/image-entry-variant.enum';
import { FileType2Mime } from 'picsur-shared/dist/dto/mimes.dto';
import { HasFailed } from 'picsur-shared/dist/types/failable';
import { UUIDRegex } from 'picsur-shared/dist/util/common-regex';
import { In, Repository } from 'typeorm';
import { EImageDerivativeBackend } from '../../database/entities/images/image-derivative.entity.js';
import { EImageFileBackend } from '../../database/entities/images/image-file.entity.js';
import { EImageBackend } from '../../database/entities/images/image.entity.js';
import { ObjectStorageService } from '../object-storage/object-storage.service.js';

export interface StorageStatus {
  files: { database: number; objectStorage: number };
  derivatives: { database: number; objectStorage: number };
}

export interface MigrationResult {
  moved: number;
  movedBytes: number;
  failed: number;
  droppedDerivatives: number;
}

export interface GcResult {
  orphanedImages: number;
  orphanedObjects: number;
  deleted: boolean;
}

interface FileRow {
  id: string;
  image_id: string;
  variant: ImageEntryVariant;
  filetype: string;
  storage_key: string | null;
}

// Objects younger than this are left alone by the garbage collection by
// default, they might belong to an upload that is still being saved
export const GC_DEFAULT_MIN_AGE_MS = 60 * 60 * 1000;

// Maintenance tasks for image storage, used by the command line tool
@Injectable()
export class ImageStorageMaintenanceService {
  private readonly logger = new Logger('Storage');

  constructor(
    @InjectRepository(EImageBackend)
    private readonly imageRepo: Repository<EImageBackend>,
    @InjectRepository(EImageFileBackend)
    private readonly fileRepo: Repository<EImageFileBackend>,
    @InjectRepository(EImageDerivativeBackend)
    private readonly derivativeRepo: Repository<EImageDerivativeBackend>,
    private readonly objectStorage: ObjectStorageService,
  ) {}

  public async status(): Promise<StorageStatus> {
    const count = async (
      repo: Repository<EImageFileBackend> | Repository<EImageDerivativeBackend>,
      inDatabase: boolean,
    ) =>
      repo
        .createQueryBuilder('row')
        .where(inDatabase ? 'row.data IS NOT NULL' : 'row.data IS NULL')
        .getCount();

    return {
      files: {
        database: await count(this.fileRepo, true),
        objectStorage: await count(this.fileRepo, false),
      },
      derivatives: {
        database: await count(this.derivativeRepo, true),
        objectStorage: await count(this.derivativeRepo, false),
      },
    };
  }

  // Moves all image files to where new ones are stored. Cached derivatives in
  // the other location are simply dropped, they are generated again when
  // needed. Safe to run while Picsur is running, and to run again after it
  // was interrupted.
  public async migrate(batchSize = 50): Promise<MigrationResult> {
    const toObjectStorage = this.objectStorage.isWriteTarget;
    const result: MigrationResult = {
      moved: 0,
      movedBytes: 0,
      failed: 0,
      droppedDerivatives: 0,
    };

    let lastId = '00000000-0000-0000-0000-000000000000';
    for (;;) {
      const rows: FileRow[] = await this.fileRepo
        .createQueryBuilder('file')
        .select('file._id', 'id')
        .addSelect('file.image_id', 'image_id')
        .addSelect('file.variant', 'variant')
        .addSelect('file.filetype', 'filetype')
        .addSelect('file.storage_key', 'storage_key')
        .where(toObjectStorage ? 'file.data IS NOT NULL' : 'file.data IS NULL')
        .andWhere('file._id > :lastId', { lastId })
        .orderBy('file._id', 'ASC')
        .limit(batchSize)
        .getRawMany();
      if (rows.length === 0) break;
      lastId = rows[rows.length - 1].id;

      for (const row of rows) {
        const moved = toObjectStorage
          ? await this.moveToObjectStorage(row)
          : await this.moveToDatabase(row);
        if (moved === false) {
          result.failed++;
        } else {
          result.moved++;
          result.movedBytes += moved;
        }
      }

      this.logger.log(
        `Moved ${result.moved} files (${formatBytes(result.movedBytes)})` +
          (result.failed > 0 ? `, ${result.failed} failed` : ''),
      );
    }

    // Cached conversions stored in the old location are dropped
    result.droppedDerivatives = await this.dropDerivatives(toObjectStorage);
    return result;
  }

  // Deletes objects that no image refers to anymore. These are left behind
  // when deleting them failed, for example because the bucket was not
  // reachable at the time.
  public async gc(
    dryRun: boolean,
    minAgeMs = GC_DEFAULT_MIN_AGE_MS,
  ): Promise<GcResult> {
    const result: GcResult = {
      orphanedImages: 0,
      orphanedObjects: 0,
      deleted: !dryRun,
    };

    const ids = await this.objectStorage.listImageIds();
    if (HasFailed(ids)) throw ids;
    // Anything that does not look like one of our images is not ours to
    // delete
    const imageIds = ids.filter((id) => UUIDRegex.test(id));

    const minAge = new Date(Date.now() - minAgeMs);
    for (let i = 0; i < imageIds.length; i += 500) {
      const batch = imageIds.slice(i, i + 500);
      const existing = new Set(
        (
          await this.imageRepo.find({
            where: { id: In(batch) },
            select: ['id'],
          })
        ).map((image) => image.id),
      );

      for (const imageId of batch) {
        const objects = await this.objectStorage.listImageObjects(imageId);
        if (HasFailed(objects)) throw objects;

        let orphans = objects.filter((object) => object.lastModified < minAge);
        if (existing.has(imageId)) {
          const referenced = await this.referencedKeys(imageId);
          orphans = orphans.filter((object) => !referenced.has(object.key));
        } else if (orphans.length > 0) {
          result.orphanedImages++;
        }
        if (orphans.length === 0) continue;

        result.orphanedObjects += orphans.length;
        for (const object of orphans) {
          this.logger.log(
            `${dryRun ? 'Would delete' : 'Deleting'} ${object.key}`,
          );
        }
        if (!dryRun) {
          const deleted = await this.objectStorage.delete(
            orphans.map((object) => object.key),
          );
          if (HasFailed(deleted)) throw deleted;
        }
      }
    }

    return result;
  }

  private async moveToObjectStorage(row: FileRow): Promise<number | false> {
    const withData = await this.fileRepo
      .createQueryBuilder('file')
      .select('file.data', 'data')
      .where('file._id = :id', { id: row.id })
      .getRawOne<{ data: Buffer | null }>();
    if (!withData?.data) return 0; // Moved or deleted in the meantime

    const key = this.objectStorage.fileKey(row.image_id, row.variant);
    const mime = FileType2Mime(row.filetype);
    const stored = await this.objectStorage.put(
      key,
      withData.data,
      HasFailed(mime) ? 'application/octet-stream' : mime,
    );
    if (HasFailed(stored)) {
      stored.print(this.logger, { prefix: `Image ${row.image_id}:` });
      return false;
    }

    await this.fileRepo
      .createQueryBuilder()
      .update()
      .set({ data: null, storage_key: key })
      .where('_id = :id', { id: row.id })
      .execute();
    return withData.data.length;
  }

  private async moveToDatabase(row: FileRow): Promise<number | false> {
    if (row.storage_key === null) return 0;

    const data = await this.objectStorage.get(row.storage_key);
    if (HasFailed(data)) {
      data.print(this.logger, { prefix: `Image ${row.image_id}:` });
      return false;
    }

    await this.fileRepo
      .createQueryBuilder()
      .update()
      .set({ data, storage_key: null })
      .where('_id = :id AND storage_key = :key', {
        id: row.id,
        key: row.storage_key,
      })
      .execute();

    const deleted = await this.objectStorage.delete([row.storage_key]);
    if (HasFailed(deleted)) {
      deleted.print(this.logger, { prefix: `Image ${row.image_id}:` });
    }
    return data.length;
  }

  // Drops derivatives stored in the database (when inDatabase is true), or in
  // object storage
  private async dropDerivatives(inDatabase: boolean): Promise<number> {
    const result = await this.derivativeRepo
      .createQueryBuilder()
      .delete()
      .where(inDatabase ? 'data IS NOT NULL' : 'data IS NULL')
      .returning(['storage_key'])
      .execute();
    const rows: { storage_key: string | null }[] = result.raw;

    const keys = rows
      .map((row) => row.storage_key)
      .filter((key) => key !== null);
    if (keys.length > 0) {
      const deleted = await this.objectStorage.delete(keys);
      if (HasFailed(deleted)) {
        deleted.print(this.logger, { prefix: 'Dropping derivatives:' });
      }
    }

    return rows.length;
  }

  private async referencedKeys(imageId: string): Promise<Set<string>> {
    const [files, derivatives] = await Promise.all([
      this.fileRepo.find({
        where: { image_id: imageId },
        select: ['storage_key'],
      }),
      this.derivativeRepo.find({
        where: { image_id: imageId },
        select: ['storage_key'],
      }),
    ]);
    return new Set(
      [...files, ...derivatives]
        .map((row) => row.storage_key)
        .filter((key) => key !== null),
    );
  }
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
