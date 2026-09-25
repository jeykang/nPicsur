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
import { EImageFileBackend } from '../../database/entities/images/image-file.entity.js';
import { ObjectStorageService } from '../object-storage/object-storage.service.js';

const A_DAY_IN_SECONDS = 24 * 60 * 60;

// An image file or derivative together with its data, wherever it is stored
export interface StoredImage {
  filetype: string;
  data: Buffer;
}

interface StoredRow {
  filetype: string;
  data?: Buffer | null;
  storage_key: string | null;
}

// Keeps track of the files belonging to an image (the master and possibly
// the original upload) and of cached derivatives. Their data either lives in
// the database, or in object storage when that is the configured driver. Rows
// always say where their data is, so both can be mixed.
@Injectable()
export class ImageFileDBService {
  private readonly logger = new Logger(ImageFileDBService.name);

  constructor(
    @InjectRepository(EImageFileBackend)
    private readonly imageFileRepo: Repository<EImageFileBackend>,

    @InjectRepository(EImageDerivativeBackend)
    private readonly imageDerivativeRepo: Repository<EImageDerivativeBackend>,

    private readonly objectStorage: ObjectStorageService,
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
      this.objectStorage.fileKey(imageId, variant),
      file,
      filetype,
    );
    if (HasFailed(location)) return location;
    imageFile.data = location.data;
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
        select: { filetype: true, data: true, storage_key: true },
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
      this.objectStorage.derivativeKey(imageId, key),
      file,
      filetype,
    );
    if (HasFailed(location)) return location;
    imageDerivative.data = location.data;
    imageDerivative.storage_key = location.storage_key;

    try {
      await this.imageDerivativeRepo.save(imageDerivative);
    } catch (e) {
      // Without its row the object is never used
      if (location.storage_key !== null) {
        const deleted = await this.objectStorage.delete([location.storage_key]);
        if (HasFailed(deleted)) deleted.print(this.logger);
      }
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
          storage_key: true,
          last_read: true,
        },
      });
    } catch (e) {
      return Fail(FT.Database, e);
    }
    if (!derivative) return null;

    const loaded = await this.load(derivative);
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
    let deleted: { storage_key: string | null }[];
    try {
      const result = await this.imageDerivativeRepo
        .createQueryBuilder()
        .delete()
        .where('last_read < :cutoff', {
          cutoff: new Date(Date.now() - olderThanSeconds * 1000),
        })
        .returning(['storage_key'])
        .execute();
      deleted = result.raw;
    } catch (e) {
      return Fail(FT.Database, e);
    }

    await this.deleteObjects(
      deleted.map((row) => row.storage_key).filter((key) => key !== null),
    );

    return deleted.length;
  }

  // Removes the stored data of images that were deleted from the database
  public async deleteStoredData(imageIds: string[] | 'all'): Promise<void> {
    if (!this.objectStorage.isConfigured) return;
    if (imageIds !== 'all' && imageIds.length === 0) return;

    const ids =
      imageIds === 'all' ? await this.objectStorage.listImageIds() : imageIds;
    if (HasFailed(ids)) {
      ids.print(this.logger, { prefix: 'Cleaning up deleted images:' });
      return;
    }

    const result = await this.objectStorage.deleteImages(ids);
    if (HasFailed(result)) {
      // Nothing refers to these objects anymore, they only take up space.
      // The storage gc command cleans them up later.
      result.print(this.logger, { prefix: 'Cleaning up deleted images:' });
    }
  }

  // Writes image data to where new data goes, and returns what the row should
  // contain to find it again
  private async store(
    objectKey: string,
    data: Buffer,
    filetype: string,
  ): AsyncFailable<{ data: Buffer | null; storage_key: string | null }> {
    if (!this.objectStorage.isWriteTarget) {
      return { data, storage_key: null };
    }

    const mime = FileType2Mime(filetype);
    const stored = await this.objectStorage.put(
      objectKey,
      data,
      HasFailed(mime) ? 'application/octet-stream' : mime,
    );
    if (HasFailed(stored)) return stored;

    return { data: null, storage_key: objectKey };
  }

  private async load(row: StoredRow): AsyncFailable<StoredImage> {
    if (row.data !== null && row.data !== undefined) {
      return { filetype: row.filetype, data: row.data };
    }
    if (row.storage_key !== null) {
      const data = await this.objectStorage.get(row.storage_key);
      if (HasFailed(data)) return data;
      return { filetype: row.filetype, data };
    }
    return Fail(FT.Internal, 'Image data is missing');
  }

  private async deleteObjects(keys: string[]) {
    if (keys.length === 0) return;
    const result = await this.objectStorage.delete(keys);
    if (HasFailed(result)) {
      result.print(this.logger, { prefix: 'Deleting cached images:' });
    }
  }
}
