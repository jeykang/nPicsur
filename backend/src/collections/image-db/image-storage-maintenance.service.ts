import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ImageEntryVariant } from 'picsur-shared/dist/dto/image-entry-variant.enum';
import { FileType2Mime } from 'picsur-shared/dist/dto/mimes.dto';
import { Failure, HasFailed } from 'picsur-shared/dist/types/failable';
import { UUIDRegex } from 'picsur-shared/dist/util/common-regex';
import { In, Repository } from 'typeorm';
import {
  ExternalStorageDriver,
  StorageDriver,
} from '../../config/early/storage.config.service.js';
import { EImageDerivativeBackend } from '../../database/entities/images/image-derivative.entity.js';
import { EImageFileBackend } from '../../database/entities/images/image-file.entity.js';
import { EImageBackend } from '../../database/entities/images/image.entity.js';
import { ExternalStorage } from '../external-storage/external-storage.js';
import { ExternalStorageService } from '../external-storage/external-storage.service.js';

// How many are stored in each place
export type LocationCounts = Record<StorageDriver, number>;

export interface StorageStatus {
  files: LocationCounts;
  derivatives: LocationCounts;
}

export interface MigrationResult {
  moved: number;
  movedBytes: number;
  failed: number;
  droppedDerivatives: number;
  // Whether it was stopped before everything was moved
  stopped: boolean;
}

export interface MigrationOptions {
  batchSize?: number;
  // Called after every file
  onProgress?: (result: MigrationResult) => void;
  // Checked before every file, stops moving files when it returns true
  shouldStop?: () => boolean;
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
  storage: ExternalStorageDriver | null;
  storage_key: string | null;
}

// Objects younger than this are left alone by the garbage collection by
// default, they might belong to an upload that is still being saved
export const GC_DEFAULT_MIN_AGE_MS = 60 * 60 * 1000;

// Maintenance tasks for image storage, used by the command line tool and the
// settings page
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
    private readonly storages: ExternalStorageService,
  ) {}

  public async status(): Promise<StorageStatus> {
    const count = async (
      repo: Repository<EImageFileBackend> | Repository<EImageDerivativeBackend>,
    ): Promise<LocationCounts> => {
      const rows: { storage: string | null; count: string }[] = await repo
        .createQueryBuilder('row')
        .select('row.storage', 'storage')
        .addSelect('COUNT(*)', 'count')
        .groupBy('row.storage')
        .getRawMany();

      const counts: LocationCounts = {
        [StorageDriver.Database]: 0,
        [StorageDriver.S3]: 0,
        [StorageDriver.Filesystem]: 0,
      };
      for (const row of rows) {
        const location = (row.storage ??
          StorageDriver.Database) as StorageDriver;
        if (location in counts) counts[location] += Number(row.count);
      }
      return counts;
    };

    return {
      files: await count(this.fileRepo),
      derivatives: await count(this.derivativeRepo),
    };
  }

  // Where new image data goes
  public get target(): StorageDriver {
    return this.storages.writeTarget?.driver ?? StorageDriver.Database;
  }

  // Moves all image files to where new ones are stored, from wherever they
  // are. Cached derivatives elsewhere are simply dropped, they are generated
  // again when needed. Safe to run while Picsur is running, and to run again
  // after it was interrupted.
  public async migrate(
    options: MigrationOptions = {},
  ): Promise<MigrationResult> {
    const { batchSize = 50, onProgress, shouldStop = () => false } = options;
    const target = this.storages.writeTarget;
    const result: MigrationResult = {
      moved: 0,
      movedBytes: 0,
      failed: 0,
      droppedDerivatives: 0,
      stopped: false,
    };

    let lastId = '00000000-0000-0000-0000-000000000000';
    while (!result.stopped) {
      const rows: FileRow[] = await this.fileRepo
        .createQueryBuilder('file')
        .select('file._id', 'id')
        .addSelect('file.image_id', 'image_id')
        .addSelect('file.variant', 'variant')
        .addSelect('file.filetype', 'filetype')
        .addSelect('file.storage', 'storage')
        .addSelect('file.storage_key', 'storage_key')
        .where(
          target === null
            ? 'file.storage IS NOT NULL'
            : 'file.storage IS DISTINCT FROM :target',
          { target: target?.driver },
        )
        .andWhere('file._id > :lastId', { lastId })
        .orderBy('file._id', 'ASC')
        .limit(batchSize)
        .getRawMany();
      if (rows.length === 0) break;
      lastId = rows[rows.length - 1].id;

      for (const row of rows) {
        if (shouldStop()) {
          result.stopped = true;
          break;
        }
        const moved = await this.move(row, target);
        if (moved === false) {
          result.failed++;
        } else {
          result.moved++;
          result.movedBytes += moved;
        }
        onProgress?.(result);
      }

      this.logger.log(
        `Moved ${result.moved} files (${formatBytes(result.movedBytes)})` +
          (result.failed > 0 ? `, ${result.failed} failed` : ''),
      );
    }

    if (result.stopped) {
      this.logger.log('Stopped moving files');
      return result;
    }

    // Cached conversions stored elsewhere are dropped
    result.droppedDerivatives = await this.dropDerivatives(
      target === null
        ? 'storage IS NOT NULL'
        : 'storage IS DISTINCT FROM :target',
      { target: target?.driver },
    );
    return result;
  }

  // Drops the cached conversions kept in this storage, when it is going to
  // be somewhere else
  public async dropDerivativesIn(
    driver: ExternalStorageDriver,
  ): Promise<number> {
    return this.dropDerivatives('storage = :driver', { driver });
  }

  // Deletes files that no image refers to anymore. These are left behind when
  // deleting them failed, for example because the bucket was not reachable at
  // the time.
  public async gc(
    dryRun: boolean,
    minAgeMs = GC_DEFAULT_MIN_AGE_MS,
  ): Promise<GcResult> {
    const result: GcResult = {
      orphanedImages: 0,
      orphanedObjects: 0,
      deleted: !dryRun,
    };
    for (const storage of this.storages.configured) {
      await this.gcStorage(storage, dryRun, minAgeMs, result);
    }
    return result;
  }

  private async gcStorage(
    storage: ExternalStorage,
    dryRun: boolean,
    minAgeMs: number,
    result: GcResult,
  ) {
    const ids = await storage.listImageIds();
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
        const objects = await storage.listImageObjects(imageId);
        if (HasFailed(objects)) throw objects;

        let orphans = objects.filter((object) => object.lastModified < minAge);
        if (existing.has(imageId)) {
          const referenced = await this.referencedKeys(imageId, storage.driver);
          orphans = orphans.filter((object) => !referenced.has(object.key));
        } else if (orphans.length > 0) {
          result.orphanedImages++;
        }
        if (orphans.length === 0) continue;

        result.orphanedObjects += orphans.length;
        for (const object of orphans) {
          this.logger.log(
            `${dryRun ? 'Would delete' : 'Deleting'} ${object.key} in ${storage.description}`,
          );
        }
        if (!dryRun) {
          const deleted = await storage.delete(
            orphans.map((object) => object.key),
          );
          if (HasFailed(deleted)) throw deleted;
        }
      }
    }
  }

  // Moves one file to where new ones go, returns how large it is, or false
  // when it could not be moved
  private async move(
    row: FileRow,
    target: ExternalStorage | null,
  ): Promise<number | false> {
    const failed = (reason: Failure) => {
      reason.print(this.logger, { prefix: `Image ${row.image_id}:` });
      return false as const;
    };

    // Read it from where it is
    const source = row.storage === null ? null : this.storages.get(row.storage);
    let data: Buffer;
    if (row.storage === null) {
      const withData = await this.fileRepo
        .createQueryBuilder('file')
        .select('file.data', 'data')
        .where('file._id = :id', { id: row.id })
        .getRawOne<{ data: Buffer | null }>();
      if (!withData?.data) return 0; // Moved or deleted in the meantime
      data = withData.data;
    } else {
      if (!source?.isConfigured || row.storage_key === null) {
        this.logger.error(
          `Image ${row.image_id}: stored in ${row.storage}, which is not configured`,
        );
        return false;
      }
      const loaded = await source.get(row.storage_key);
      if (HasFailed(loaded)) return failed(loaded);
      data = loaded;
    }

    // Write it to where new ones go
    let key: string | null = null;
    if (target !== null) {
      key = target.fileKey(row.image_id, row.variant);
      const mime = FileType2Mime(row.filetype);
      const stored = await target.put(
        key,
        data,
        HasFailed(mime) ? 'application/octet-stream' : mime,
      );
      if (HasFailed(stored)) return failed(stored);
    }

    // Only when it is still where it was read from
    const update = this.fileRepo
      .createQueryBuilder()
      .update()
      .set(
        target === null
          ? { data, storage: null, storage_key: null }
          : { data: null, storage: target.driver, storage_key: key },
      )
      .where('_id = :id', { id: row.id });
    if (row.storage === null) {
      update.andWhere('storage IS NULL');
    } else {
      update.andWhere('storage = :storage AND storage_key = :key', {
        storage: row.storage,
        key: row.storage_key,
      });
    }
    const updated = await update.execute();

    if (!updated.affected && target !== null && key !== null) {
      // Deleted or moved in the meantime, so the copy is not used
      const deleted = await target.delete([key]);
      if (HasFailed(deleted)) failed(deleted);
      return 0;
    }

    // The old copy is not needed anymore
    if (source !== null && row.storage_key !== null) {
      const deleted = await source.delete([row.storage_key]);
      if (HasFailed(deleted)) failed(deleted);
    }
    return data.length;
  }

  // Drops the derivatives matching the condition, and whatever is stored for
  // them outside the database
  private async dropDerivatives(
    condition: string,
    parameters: Record<string, unknown>,
  ): Promise<number> {
    const result = await this.derivativeRepo
      .createQueryBuilder()
      .delete()
      .where(condition, parameters)
      .returning(['storage', 'storage_key'])
      .execute();
    const rows: { storage: string | null; storage_key: string | null }[] =
      result.raw;

    const keys = new Map<string, string[]>();
    for (const row of rows) {
      if (row.storage === null || row.storage_key === null) continue;
      keys.set(row.storage, [
        ...(keys.get(row.storage) ?? []),
        row.storage_key,
      ]);
    }
    for (const [driver, storageKeys] of keys) {
      const storage = this.storages.get(driver);
      if (!storage?.isConfigured) continue;
      const deleted = await storage.delete(storageKeys);
      if (HasFailed(deleted)) {
        deleted.print(this.logger, { prefix: 'Dropping derivatives:' });
      }
    }

    return rows.length;
  }

  private async referencedKeys(
    imageId: string,
    driver: ExternalStorageDriver,
  ): Promise<Set<string>> {
    const [files, derivatives] = await Promise.all([
      this.fileRepo.find({
        where: { image_id: imageId, storage: driver },
        select: ['storage_key'],
      }),
      this.derivativeRepo.find({
        where: { image_id: imageId, storage: driver },
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
