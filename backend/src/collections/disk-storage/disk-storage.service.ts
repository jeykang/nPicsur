import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { ImageEntryVariant } from 'picsur-shared/dist/dto/image-entry-variant.enum';
import {
  AsyncFailable,
  Fail,
  Failable,
  FT,
  HasFailed,
} from 'picsur-shared/dist/types/failable';
import {
  FilesystemStorageConfig,
  StorageConfigService,
  StorageDriver,
} from '../../config/early/storage.config.service.js';
import {
  ExternalStorage,
  StoredObject,
} from '../external-storage/external-storage.js';

const IMAGES_DIR = 'images';

// Keys only ever consist of ids, variants and hashes
const SafeKeySegment = /^[A-Za-z0-9_.-]{1,255}$/;

export interface DiskStorageTest {
  // Whether the directory did not exist yet
  created: boolean;
  // Why images might not be safe there, even though they can be stored
  warning: string | null;
}

// Stores image data as files in a directory, laid out the same way as in a
// bucket. The database keeps track of which file belongs to which image.
@Injectable()
export class DiskStorageService implements ExternalStorage {
  public readonly driver = StorageDriver.Filesystem;

  private readonly config: FilesystemStorageConfig | null;

  // Whether new image data is written to the directory
  public readonly isWriteTarget: boolean;

  // Why images in the directory might not be safe there, found when starting
  public warning: string | null = null;

  constructor(storageConfig: StorageConfigService) {
    this.config = storageConfig.getFilesystemConfig();
    this.isWriteTarget = storageConfig.getDriver() === StorageDriver.Filesystem;
  }

  public get isConfigured(): boolean {
    return this.config !== null;
  }

  public get description(): string {
    return `the directory "${this.config?.path}"`;
  }

  public fileKey(imageId: string, variant: ImageEntryVariant): string {
    return `${IMAGES_DIR}/${imageId}/${variant}`;
  }

  public derivativeKey(imageId: string, key: string): string {
    return `${IMAGES_DIR}/${imageId}/derivatives/${key}`;
  }

  // Makes sure images can be stored in the directory, and creates it when it
  // does not exist
  public async ensureDirectory(): AsyncFailable<DiskStorageTest> {
    const tested = await TestDiskStorage(this.assertConfigured());
    if (!HasFailed(tested)) this.warning = tested.warning;
    return tested;
  }

  // Files have no content type, their row says what they are
  public async put(
    key: string,
    data: Buffer,
    _contentType?: string,
  ): AsyncFailable<true> {
    const path = this.path(key);
    if (HasFailed(path)) return path;

    // Written under another name first, so a file is either complete or not
    // there at all, also when Picsur stops halfway
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(path), { recursive: true });
      const file = await open(temporary, 'wx');
      try {
        await file.writeFile(data);
        // On disk before it gets its name, a crash could otherwise leave an
        // empty file behind
        await file.datasync();
      } finally {
        await file.close();
      }
      await rename(temporary, path);
      return true;
    } catch (e) {
      await rm(temporary, { force: true }).catch(() => undefined);
      return Fail(FT.Internal, 'Could not store image', DescribeError(e));
    }
  }

  public async get(key: string): AsyncFailable<Buffer> {
    const path = this.path(key);
    if (HasFailed(path)) return path;

    try {
      return await readFile(path);
    } catch (e) {
      if (IsNotFound(e)) {
        return Fail(FT.NotFound, 'Image not found', `Missing file ${key}`);
      }
      return Fail(FT.Internal, 'Could not load image', DescribeError(e));
    }
  }

  public async delete(keys: string[]): AsyncFailable<true> {
    const directories = new Set<string>();
    for (const key of keys) {
      const path = this.path(key);
      if (HasFailed(path)) return path;
      try {
        await rm(path, { force: true });
      } catch (e) {
        return Fail(FT.Internal, 'Could not delete images', DescribeError(e));
      }
      directories.add(dirname(path));
    }

    // Directories of images that have nothing left in them go as well
    for (const directory of directories) await this.removeIfEmpty(directory);
    return true;
  }

  public async deleteImages(imageIds: string[]): AsyncFailable<true> {
    for (const imageId of imageIds) {
      const path = this.path(`${IMAGES_DIR}/${imageId}`);
      if (HasFailed(path)) return path;
      try {
        await rm(path, { recursive: true, force: true });
      } catch (e) {
        return Fail(FT.Internal, 'Could not delete images', DescribeError(e));
      }
    }
    return true;
  }

  public async listImageIds(): AsyncFailable<string[]> {
    const root = this.assertConfigured().path;
    try {
      const entries = await readdir(join(root, IMAGES_DIR), {
        withFileTypes: true,
      });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch (e) {
      if (IsNotFound(e)) return [];
      return Fail(FT.Internal, 'Could not list images', DescribeError(e));
    }
  }

  // Everything stored for an image, including files that were never
  // completely written
  public async listImageObjects(
    imageId: string,
  ): AsyncFailable<StoredObject[]> {
    const root = this.assertConfigured().path;
    const directory = this.path(`${IMAGES_DIR}/${imageId}`);
    if (HasFailed(directory)) return directory;

    const objects: StoredObject[] = [];
    try {
      const entries = await readdir(directory, {
        recursive: true,
        withFileTypes: true,
      });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const path = join(entry.parentPath, entry.name);
        const info = await stat(path);
        objects.push({
          key: relative(root, path).split(sep).join('/'),
          lastModified: info.mtime,
        });
      }
    } catch (e) {
      if (IsNotFound(e)) return [];
      return Fail(FT.Internal, 'Could not list images', DescribeError(e));
    }
    return objects;
  }

  // The file of a key, which is always inside the directory
  private path(key: string): Failable<string> {
    const root = this.assertConfigured().path;
    const segments = key.split('/');
    if (
      segments.some(
        (segment) =>
          !SafeKeySegment.test(segment) || segment === '.' || segment === '..',
      )
    ) {
      return Fail(FT.Internal, 'Invalid image key', `Invalid key "${key}"`);
    }
    return join(root, ...segments);
  }

  // Removes the directory when it is empty, and then its parents up to the
  // directory of the image
  private async removeIfEmpty(directory: string) {
    const images = join(this.assertConfigured().path, IMAGES_DIR);
    let current = directory;
    while (dirname(current) !== current && current.startsWith(images + sep)) {
      try {
        await rmdir(current);
      } catch {
        // Not empty, or already gone
        return;
      }
      current = dirname(current);
    }
  }

  private assertConfigured(): FilesystemStorageConfig {
    if (this.config === null) {
      // Only happens when the database refers to files while no directory is
      // configured anymore
      throw Fail(
        FT.Internal,
        'Image storage is not configured',
        'Image data is stored on disk, but no directory is configured',
      );
    }
    return this.config;
  }
}

// Checks that images can be stored in the directory before it is used, and
// creates it when it does not exist yet, like Picsur does when it starts
export async function TestDiskStorage(
  config: FilesystemStorageConfig,
): AsyncFailable<DiskStorageTest> {
  const path = config.path;
  // The reasons are shown on the settings page, where the details help
  const failure = (message: string, e: unknown) =>
    Fail(FT.BadRequest, `${message}: ${DescribeError(e)}`);

  let created = false;
  try {
    const info = await stat(path);
    if (!info.isDirectory()) {
      return Fail(FT.BadRequest, `"${path}" is not a directory`);
    }
  } catch (e) {
    if (!IsNotFound(e)) return failure(`Can not access "${path}"`, e);
    try {
      await mkdir(path, { recursive: true });
      created = true;
    } catch (e) {
      return failure(`"${path}" does not exist and could not be created`, e);
    }
  }

  const test = join(path, `.picsur-test-${randomUUID()}`);
  const content = 'Picsur checks that it can store images here';
  try {
    await writeFile(test, content);
    if ((await readFile(test, 'utf8')) !== content) {
      return Fail(FT.BadRequest, `Files in "${path}" do not read back right`);
    }
  } catch (e) {
    return failure(`Can not store files in "${path}"`, e);
  } finally {
    await rm(test, { force: true }).catch(() => undefined);
  }

  return { created, warning: await ContainerWarning(path) };
}

// Files written in a container, but not to a volume, are gone when the
// container is replaced, which happens with every update
async function ContainerWarning(path: string): Promise<string | null> {
  let mounts: string;
  let real: string;
  try {
    mounts = await readFile('/proc/self/mountinfo', 'utf8');
    real = await realpath(path);
  } catch {
    // Not Linux, which is not in a container either
    return null;
  }

  const { mountPoint, rootType } = MountOf(real, mounts);
  const inContainer =
    existsSync('/.dockerenv') ||
    existsSync('/run/.containerenv') ||
    rootType === 'overlay';
  if (!inContainer || mountPoint !== '/') return null;
  return `"${path}" is not on a volume, so the images stored there are lost when the container is replaced, like when Picsur is updated. Mount a volume there.`;
}

// The mount a path is on, from /proc/self/mountinfo: the one with the longest
// mount point that contains it, the last one when several are mounted at the
// same place. Also the type of the root filesystem.
export function MountOf(
  path: string,
  mountinfo: string,
): { mountPoint: string; rootType: string } {
  let mountPoint = '';
  let rootType = '';
  for (const line of mountinfo.split('\n')) {
    const fields = line.split(' ');
    const separator = fields.indexOf('-');
    if (fields.length < 5 || separator === -1) continue;
    const point = UnescapeMountPoint(fields[4]);
    if (point === '/') rootType = fields[separator + 1] ?? '';

    const contains =
      point === '/' || path === point || path.startsWith(point + '/');
    if (contains && point.length >= mountPoint.length) mountPoint = point;
  }
  return { mountPoint, rootType };
}

// Mount points escape spaces and the like as octal numbers
function UnescapeMountPoint(point: string): string {
  return point.replace(/\\([0-7]{3})/g, (_, code: string) =>
    String.fromCharCode(parseInt(code, 8)),
  );
}

function IsNotFound(e: unknown): boolean {
  return (e as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

function DescribeError(e: unknown): string {
  const error = e as NodeJS.ErrnoException | null;
  if (error?.code === 'EACCES' || error?.code === 'EPERM') {
    return `${error.code}, Picsur is not allowed to write there`;
  }
  if (error?.code === 'ENOSPC') return `${error.code}, the disk is full`;
  if (e instanceof Error) return e.message;
  return String(e);
}
