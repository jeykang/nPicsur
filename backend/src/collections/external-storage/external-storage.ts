import type { Readable } from 'node:stream';
import { ImageEntryVariant } from 'picsur-shared/dist/dto/image-entry-variant.enum';
import { ExternalStorageDriver } from 'picsur-shared/dist/dto/storage-driver.enum';
import { AsyncFailable } from 'picsur-shared/dist/types/failable';

export interface StoredObject {
  key: string;
  lastModified: Date;
}

// Stored data that is read while it is sent on, instead of all at once
export interface StoredStream {
  stream: Readable;
  // In bytes, when known
  size: number | null;
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
  // Fails the same way as get, before anything is read. The stream has to be
  // read or destroyed, it holds on to a file or a connection until then.
  getStream(key: string): AsyncFailable<StoredStream>;
  // Keys that do not exist are ignored
  delete(keys: string[]): AsyncFailable<true>;
  // Deletes everything stored for the given images
  deleteImages(imageIds: string[]): AsyncFailable<true>;
  // The ids of all images that have something stored
  listImageIds(): AsyncFailable<string[]>;
  listImageObjects(imageId: string): AsyncFailable<StoredObject[]>;
}
