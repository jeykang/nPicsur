import { ImageEntryVariant } from 'picsur-shared/dist/dto/image-entry-variant.enum';
import { AsyncFailable } from 'picsur-shared/dist/types/failable';
import { ExternalStorageDriver } from '../../config/early/storage.config.service.js';

export interface StoredObject {
  key: string;
  lastModified: Date;
}

// Where image data is kept other than the database: a bucket, or a directory.
// Everything belonging to an image is kept under one key prefix:
//   images/<image id>/<variant>
//   images/<image id>/derivatives/<key>
export interface ExternalStorage {
  readonly driver: ExternalStorageDriver;
  // Whether it is set up, it is then also used to read what is stored there
  // before, when new image data goes elsewhere
  readonly isConfigured: boolean;
  // Whether new image data goes here
  readonly isWriteTarget: boolean;
  // Where it is, for messages
  readonly description: string;

  fileKey(imageId: string, variant: ImageEntryVariant): string;
  derivativeKey(imageId: string, key: string): string;

  put(key: string, data: Buffer, contentType: string): AsyncFailable<true>;
  get(key: string): AsyncFailable<Buffer>;
  // Keys that do not exist are ignored
  delete(keys: string[]): AsyncFailable<true>;
  // Deletes everything stored for the given images
  deleteImages(imageIds: string[]): AsyncFailable<true>;
  // The ids of all images that have something stored
  listImageIds(): AsyncFailable<string[]>;
  listImageObjects(imageId: string): AsyncFailable<StoredObject[]>;
}
