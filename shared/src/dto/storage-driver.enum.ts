import { z } from 'zod';

// Where image data is stored
export enum StorageDriver {
  // In the database, next to everything else
  Database = 'database',
  // In an S3 compatible bucket
  S3 = 's3',
  // As files in a directory
  Filesystem = 'filesystem',
}
export const StorageDriverList: StorageDriver[] = Object.values(StorageDriver);
export const StorageDriverSchema = z.nativeEnum(StorageDriver);

// Storage other than the database, rows say which one their data is in
export type ExternalStorageDriver = StorageDriver.S3 | StorageDriver.Filesystem;
export const ExternalStorageDriverSchema = z.enum([
  StorageDriver.S3,
  StorageDriver.Filesystem,
]);
