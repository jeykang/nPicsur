import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ImageEntryVariant } from 'picsur-shared/dist/dto/image-entry-variant.enum';
import { FileType2Mime } from 'picsur-shared/dist/dto/mimes.dto';
import {
  AsyncFailable,
  Fail,
  FT,
  HasFailed,
} from 'picsur-shared/dist/types/failable';
import { QueryFailedError, Repository } from 'typeorm';
import { EImageDerivativeBackend } from '../../database/entities/images/image-derivative.entity.js';
import { ExternalStorageDriver } from '../../config/early/storage.config.service.js';
import { EImageFileBackend } from '../../database/entities/images/image-file.entity.js';
import { ExternalStorage } from '../external-storage/external-storage.js';
import { ExternalStorageService } from '../external-storage/external-storage.service.js';

const A_DAY_IN_SECONDS = 24 * 60 * 60;

// An image file or derivative together with its data, wherever it is stored
export interface StoredImage {
  filetype: string;
  data: Buffer;
}

interface StoredRow {
  filetype: string;
  data?: Buffer | null;
  storage: string | null;
  storage_key: string | null;
}

// Where a row's data is outside the database
interface StoredLocation {
  storage: string | null;
  storage_key: string | null;
}

// Keeps track of the files belonging to an image (the master and possibly
// the original upload) and of cached derivatives. Their data lives in the
// database, in a bucket or in a directory, depending on the configured
// driver. Rows always say where their data is, so they can be mixed.
@Injectable()
export class ImageFileDBService {
  private readonly logger = new Logger(ImageFileDBService.name);

  constructor(
    @InjectRepository(EImageFileBackend)
    private readonly imageFileRepo: Repository<EImageFileBackend>,

    @InjectRepository(EImageDerivativeBackend)
    private readonly imageDerivativeRepo: Repository<EImageDerivativeBackend>,

    private readonly storages: ExternalStorageService,
  ) {}

  // Files are only written once, when an image is uploaded
  public async setFile(
    imageId: string,
    variant: ImageEntryVariant,
    file: Buffer,
    filetype: string,
  ): AsyncFailable<true> {
    const imageFile = new EImageFileBackend();
    imageFile.image_id = imageId;
    imageFile.variant = variant;
    imageFile.filetype = filetype;

    const location = await this.store(
      (storage) => storage.fileKey(imageId, variant),
      file,
      filetype,
    );
    if (HasFailed(location)) return location;
    imageFile.data = location.data;
    imageFile.storage = location.storage;
    imageFile.storage_key = location.storage_key;

    try {
      await this.imageFileRepo.upsert(imageFile, {
        conflictPaths: ['image_id', 'variant'],
      });
    } catch (e) {
      return Fail(FT.Database, e);
    }

    return true;
  }

  public async getFile(
    imageId: string,
    variant: ImageEntryVariant,
  ): AsyncFailable<StoredImage> {
    let found: StoredRow | null;
    try {
      found = await this.imageFileRepo.findOne({
        where: { image_id: imageId ?? '', variant: variant ?? '' },
        select: {
          filetype: true,
          data: true,
          storage: true,
          storage_key: true,
        },
      });
    } catch (e) {
      return Fail(FT.Database, e);
    }

    if (!found) return Fail(FT.NotFound, 'Image not found');
    return this.load(found);
  }

  // This is useful because you dont have to pull the whole image file
  public async getFileTypes(
    imageId: string,
  ): AsyncFailable<{ [key in ImageEntryVariant]?: string }> {
    try {
      const found = await this.imageFileRepo.find({
        where: { image_id: imageId },
        select: ['variant', 'filetype'],
      });

      if (!found) return Fail(FT.NotFound, 'Image not found');

      const result: { [key in ImageEntryVariant]?: string } = {};
      for (const file of found) {
        result[file.variant] = file.filetype;
      }

      return result;
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  public async addDerivative(
    imageId: string,
    key: string,
    filetype: string,
    file: Buffer,
  ): AsyncFailable<StoredImage> {
    const imageDerivative = new EImageDerivativeBackend();
    imageDerivative.image_id = imageId;
    imageDerivative.key = key;
    imageDerivative.filetype = filetype;
    imageDerivative.last_read = new Date();

    const location = await this.store(
      (storage) => storage.derivativeKey(imageId, key),
      file,
      filetype,
    );
    if (HasFailed(location)) return location;
    imageDerivative.data = location.data;
    imageDerivative.storage = location.storage;
    imageDerivative.storage_key = location.storage_key;

    try {
      await this.imageDerivativeRepo.save(imageDerivative);
    } catch (e) {
      // Without its row the stored file is never used
      await this.deleteStored([location]);
      // The image was deleted while it was being converted
      if (e instanceof QueryFailedError && e.driverError?.code === '23503') {
        return Fail(FT.NotFound, 'Image not found');
      }
      return Fail(FT.Database, e);
    }

    return { filetype, data: file };
  }

  // Returns null when derivative is not found
  public async getDerivative(
    imageId: string,
    key: string,
  ): AsyncFailable<StoredImage | null> {
    let derivative: (StoredRow & { last_read: Date }) | null;
    try {
      derivative = await this.imageDerivativeRepo.findOne({
        where: { image_id: imageId, key },
        select: {
          filetype: true,
          data: true,
          storage: true,
          storage_key: true,
          last_read: true,
        },
      });
    } catch (e) {
      return Fail(FT.Database, e);
    }
    if (!derivative) return null;

    // Also when it is in storage that is not configured anymore
    const loaded =
      derivative.data === null &&
      !this.storages.get(derivative.storage)?.isConfigured
        ? Fail(FT.NotFound, 'Cached image is in storage that is not used')
        : await this.load(derivative);
    if (HasFailed(loaded)) {
      // The object is gone, e.g. the bucket was cleaned up. Forget about it
      // so it gets generated again.
      if (loaded.getType() === FT.NotFound) {
        await this.imageDerivativeRepo
          .delete({ image_id: imageId, key })
          .catch(() => undefined);
        return null;
      }
      return loaded;
    }

    // Keep track of when it was last read with a precision of a day, so
    // not every view has to write to the database. Only the timestamp is
    // written, saving the entity would write the whole image again.
    const yesterday = new Date(Date.now() - A_DAY_IN_SECONDS * 1000);
    if (derivative.last_read < yesterday) {
      try {
        await this.imageDerivativeRepo.update(
          { image_id: imageId, key },
          { last_read: new Date() },
        );
      } catch (e) {
        return Fail(FT.Database, e);
      }
    }

    return loaded;
  }

  public async countDerivatives(imageId: string): AsyncFailable<number> {
    try {
      return await this.imageDerivativeRepo.count({
        where: { image_id: imageId },
      });
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  public async cleanupDerivatives(
    olderThanSeconds: number,
  ): AsyncFailable<number> {
    let deleted: StoredLocation[];
    try {
      const result = await this.imageDerivativeRepo
        .createQueryBuilder()
        .delete()
        .where('last_read < :cutoff', {
          cutoff: new Date(Date.now() - olderThanSeconds * 1000),
        })
        .returning(['storage', 'storage_key'])
        .execute();
      deleted = result.raw;
    } catch (e) {
      return Fail(FT.Database, e);
    }

    await this.deleteStored(deleted);
    return deleted.length;
  }

  // Removes the stored data of images that were deleted from the database
  public async deleteStoredData(imageIds: string[] | 'all'): Promise<void> {
    if (imageIds !== 'all' && imageIds.length === 0) return;

    for (const storage of this.storages.configured) {
      const ids = imageIds === 'all' ? await storage.listImageIds() : imageIds;
      const result = HasFailed(ids) ? ids : await storage.deleteImages(ids);
      if (HasFailed(result)) {
        // Nothing refers to these files anymore, they only take up space.
        // The storage gc command cleans them up later.
        result.print(this.logger, {
          prefix: `Cleaning up deleted images in ${storage.description}:`,
        });
      }
    }
  }

  // Writes image data to where new data goes, and returns what the row should
  // contain to find it again
  private async store(
    keyIn: (storage: ExternalStorage) => string,
    data: Buffer,
    filetype: string,
  ): AsyncFailable<{
    data: Buffer | null;
    storage: ExternalStorageDriver | null;
    storage_key: string | null;
  }> {
    const target = this.storages.writeTarget;
    if (target === null) return { data, storage: null, storage_key: null };

    const key = keyIn(target);
    const mime = FileType2Mime(filetype);
    const stored = await target.put(
      key,
      data,
      HasFailed(mime) ? 'application/octet-stream' : mime,
    );
    if (HasFailed(stored)) return stored;

    return { data: null, storage: target.driver, storage_key: key };
  }

  private async load(row: StoredRow): AsyncFailable<StoredImage> {
    if (row.data !== null && row.data !== undefined) {
      return { filetype: row.filetype, data: row.data };
    }
    if (row.storage_key === null) {
      return Fail(FT.Internal, 'Image data is missing');
    }

    const storage = this.storages.get(row.storage);
    if (!storage?.isConfigured) {
      // Only happens when the database refers to files in storage that is
      // not configured anymore
      return Fail(
        FT.Internal,
        'Image storage is not configured',
        `Image data is stored in ${row.storage}, which is not configured`,
      );
    }
    const data = await storage.get(row.storage_key);
    if (HasFailed(data)) return data;
    return { filetype: row.filetype, data };
  }

  // Deletes what is stored outside the database for these rows
  private async deleteStored(locations: StoredLocation[]) {
    const keys = new Map<string, string[]>();
    for (const { storage, storage_key } of locations) {
      if (storage === null || storage_key === null) continue;
      keys.set(storage, [...(keys.get(storage) ?? []), storage_key]);
    }

    for (const [driver, storageKeys] of keys) {
      const storage = this.storages.get(driver);
      if (!storage?.isConfigured) continue;
      const result = await storage.delete(storageKeys);
      if (HasFailed(result)) {
        result.print(this.logger, { prefix: 'Deleting cached images:' });
      }
    }
  }
}
