import { Injectable } from '@nestjs/common';
import { DiskStorageService } from '../disk-storage/disk-storage.service.js';
import { ObjectStorageService } from '../object-storage/object-storage.service.js';
import { ExternalStorage } from './external-storage.js';

// The places other than the database that image data can be in. Rows say which
// one their data is in, so images can be spread over all of them while they
// are moved from one to another.
@Injectable()
export class ExternalStorageService {
  public readonly all: readonly ExternalStorage[];

  constructor(
    objectStorage: ObjectStorageService,
    diskStorage: DiskStorageService,
  ) {
    this.all = [objectStorage, diskStorage];
  }

  public get configured(): ExternalStorage[] {
    return this.all.filter((storage) => storage.isConfigured);
  }

  // Where new image data goes, or null for the database
  public get writeTarget(): ExternalStorage | null {
    return this.all.find((storage) => storage.isWriteTarget) ?? null;
  }

  // The storage a row says its data is in
  public get(driver: string | null): ExternalStorage | null {
    return this.all.find((storage) => storage.driver === driver) ?? null;
  }
}
