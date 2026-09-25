import {
  chmod,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ImageEntryVariant } from 'picsur-shared/dist/dto/image-entry-variant.enum';
import { FT, HasFailed } from 'picsur-shared/dist/types/failable';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DiskStorageService,
  MountOf,
  TestDiskStorage,
} from '../../src/collections/disk-storage/disk-storage.service.js';
import {
  StorageConfigService,
  StorageDriver,
} from '../../src/config/early/storage.config.service.js';

const ImageId = '0b6f0bb5-3b3f-4a6e-9f55-8a4b1d0c1e2f';
const OtherId = '6f1c2b7e-0a1d-4c1e-8b2a-3d4e5f6a7b8c';
const Hash = 'a'.repeat(64);

let root: string;
let storage: DiskStorageService;

function diskStorage(path: string | null): DiskStorageService {
  const config = {
    getFilesystemConfig: () => (path === null ? null : { path }),
    getDriver: () => StorageDriver.Filesystem,
  } as unknown as StorageConfigService;
  return new DiskStorageService(config);
}

// Every file under the directory, relative to it
async function files(): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(root.length + 1))
    .sort();
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'picsur-disk-'));
  storage = diskStorage(root);
});

afterEach(async () => {
  await chmod(root, 0o700).catch(() => undefined);
  await rm(root, { recursive: true, force: true });
});

describe('storing images on disk', () => {
  it('writes files where their keys say', async () => {
    const master = storage.fileKey(ImageId, ImageEntryVariant.MASTER);
    const derivative = storage.derivativeKey(ImageId, Hash);
    expect(master).toBe(`images/${ImageId}/master`);

    expect(await storage.put(master, Buffer.from('master'), 'image/png')).toBe(
      true,
    );
    expect(
      await storage.put(derivative, Buffer.from('small'), 'image/webp'),
    ).toBe(true);
    // Replacing one leaves nothing else behind
    expect(await storage.put(master, Buffer.from('new'), 'image/png')).toBe(
      true,
    );

    expect(await files()).toEqual([
      `images/${ImageId}/derivatives/${Hash}`,
      `images/${ImageId}/master`,
    ]);
    expect(await storage.get(master)).toEqual(Buffer.from('new'));
    expect(await storage.get(derivative)).toEqual(Buffer.from('small'));
  });

  it('says when a file is not there', async () => {
    const missing = await storage.get(`images/${ImageId}/master`);
    expect(HasFailed(missing) && missing.getType()).toBe(FT.NotFound);
  });

  it('never reads or writes outside of the directory', async () => {
    const outside = join(root, '..', 'outside');
    for (const key of [
      '../outside',
      'images/../../outside',
      `images/${ImageId}/../../../outside`,
      '/etc/passwd',
      'images//master',
      '',
    ]) {
      const written = await storage.put(key, Buffer.from('x'), 'image/png');
      expect(HasFailed(written), key).toBe(true);
      expect(HasFailed(await storage.get(key)), key).toBe(true);
      expect(HasFailed(await storage.delete([key])), key).toBe(true);
    }
    await expect(readFile(outside)).rejects.toThrow();
    expect(await files()).toEqual([]);
  });

  it('lists and deletes what is stored for images', async () => {
    for (const id of [ImageId, OtherId]) {
      await storage.put(
        storage.fileKey(id, ImageEntryVariant.MASTER),
        Buffer.from(id),
        'image/png',
      );
      await storage.put(
        storage.derivativeKey(id, Hash),
        Buffer.from(id),
        'image/webp',
      );
    }

    expect(((await storage.listImageIds()) as string[]).sort()).toEqual(
      [ImageId, OtherId].sort(),
    );
    const objects = await storage.listImageObjects(ImageId);
    if (HasFailed(objects)) throw objects;
    expect(objects.map((object) => object.key).sort()).toEqual([
      `images/${ImageId}/derivatives/${Hash}`,
      `images/${ImageId}/master`,
    ]);
    expect(objects[0].lastModified.getTime()).toBeGreaterThan(
      Date.now() - 60_000,
    );

    // Directories without anything left in them go as well
    expect(
      await storage.delete([
        storage.derivativeKey(ImageId, Hash),
        storage.derivativeKey(ImageId, 'b'.repeat(64)),
      ]),
    ).toBe(true);
    expect(await readdir(join(root, 'images', ImageId))).toEqual(['master']);
    expect(
      await storage.delete([
        storage.fileKey(ImageId, ImageEntryVariant.MASTER),
      ]),
    ).toBe(true);
    expect(await readdir(join(root, 'images'))).toEqual([OtherId]);

    expect(await storage.deleteImages([OtherId, ImageId])).toBe(true);
    expect(await files()).toEqual([]);
    expect(await storage.listImageIds()).toEqual([]);
    expect(await storage.listImageObjects(ImageId)).toEqual([]);
  });

  it('is only used when configured', async () => {
    const unconfigured = diskStorage(null);
    expect(unconfigured.isConfigured).toBe(false);
    await expect(
      unconfigured.get(`images/${ImageId}/master`),
    ).rejects.toBeDefined();
  });
});

describe('testing a directory', () => {
  it('creates it when it does not exist', async () => {
    const path = join(root, 'new', 'images');
    const tested = await TestDiskStorage({ path });
    if (HasFailed(tested)) throw tested;
    expect(tested.created).toBe(true);
    expect(await readdir(path)).toEqual([]);

    const again = await TestDiskStorage({ path });
    expect(!HasFailed(again) && again.created).toBe(false);
  });

  it('refuses files and directories it can not write to', async () => {
    const file = join(root, 'file');
    await writeFile(file, 'x');
    const notDirectory = await TestDiskStorage({ path: file });
    expect(HasFailed(notDirectory) && notDirectory.getReason()).toContain(
      'is not a directory',
    );

    const inFile = await TestDiskStorage({ path: join(file, 'images') });
    expect(HasFailed(inFile)).toBe(true);
  });

  // Root may write anywhere
  it.skipIf(process.getuid?.() === 0)(
    'refuses directories it can not write to',
    async () => {
      await chmod(root, 0o500);
      const tested = await TestDiskStorage({ path: root });
      expect(HasFailed(tested) && tested.getReason()).toContain(
        'not allowed to write there',
      );
    },
  );

  it('finds the mount a directory is on', () => {
    const mountinfo = [
      '28 1 0:31 / / rw,relatime - overlay overlay rw,lowerdir=/a',
      '29 28 0:32 / /proc rw - proc proc rw',
      '40 28 8:1 /volumes/images /picsur/images rw - ext4 /dev/sda1 rw',
      '41 28 8:1 /data /with\\040space rw - ext4 /dev/sda1 rw',
    ].join('\n');

    expect(MountOf('/picsur/images', mountinfo)).toEqual({
      mountPoint: '/picsur/images',
      rootType: 'overlay',
    });
    expect(MountOf('/picsur/images/sub', mountinfo).mountPoint).toBe(
      '/picsur/images',
    );
    // Only whole directory names count
    expect(MountOf('/picsur/images2', mountinfo).mountPoint).toBe('/');
    expect(MountOf('/picsur', mountinfo).mountPoint).toBe('/');
    expect(MountOf('/with space/x', mountinfo).mountPoint).toBe('/with space');
  });
});
