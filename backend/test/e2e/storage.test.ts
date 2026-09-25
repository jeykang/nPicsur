import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import pg from 'pg';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { spawnBackend } from './helpers/backend.js';
import {
  Client,
  createUser,
  expectFailure,
  expectSuccess,
} from './helpers/client.js';
import { makeJpeg, makePng } from './helpers/images.js';

const env = inject('serverEnv');
const target = env['PICSUR_STORAGE_DRIVER'] ?? 'database';
const s3Configured = env['PICSUR_S3_BUCKET'] !== undefined;
const s3IsTarget = target === 's3';
// The directory is only reachable from here when the server is not in a
// container
const diskPath = env['PICSUR_STORAGE_PATH'] ?? '';
const diskConfigured = diskPath !== '' && inject('dockerImage') === null;
const diskIsTarget = target === 'filesystem';

function s3Client() {
  return new S3Client({
    region: env['PICSUR_S3_REGION'] ?? 'us-east-1',
    endpoint: env['PICSUR_S3_ENDPOINT'],
    forcePathStyle: env['PICSUR_S3_FORCE_PATH_STYLE'] === 'true',
    credentials: {
      accessKeyId: env['PICSUR_S3_ACCESS_KEY_ID'],
      secretAccessKey: env['PICSUR_S3_SECRET_ACCESS_KEY'],
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

const bucket = env['PICSUR_S3_BUCKET'];
// Normalised the same way the server does it
const prefix = (env['PICSUR_S3_PREFIX'] ?? '')
  .replace(/^\/+/, '')
  .replace(/^(.+?)\/*$/, '$1/');

// Runs the command line tool against the test database and bucket
function cli(args: string[], envOverrides: Record<string, string> = {}) {
  return new Promise<{ code: number; output: string }>((done) => {
    const child = spawnBackend(
      'cli',
      args,
      { ...env, ...envOverrides },
      inject('dockerImage'),
    );
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('close', (code) => done({ code: code ?? -1, output }));
  });
}

describe('image storage', () => {
  let db: pg.Client;
  let s3: S3Client;
  let client: Client;

  beforeAll(async () => {
    db = new pg.Client({
      host: env['PICSUR_DB_HOST'],
      port: Number(env['PICSUR_DB_PORT']),
      user: env['PICSUR_DB_USERNAME'],
      password: env['PICSUR_DB_PASSWORD'],
      database: env['PICSUR_DB_DATABASE'],
    });
    await db.connect();
    if (s3Configured) s3 = s3Client();
    client = await Client.admin();
  });

  afterAll(async () => {
    await db.end();
    s3?.destroy();
  });

  async function fileRows(imageId: string) {
    const result = await db.query(
      `SELECT variant, data IS NOT NULL AS in_db, storage, storage_key
         FROM e_image_file_backend WHERE image_id = $1 ORDER BY variant`,
      [imageId],
    );
    return result.rows as {
      variant: string;
      in_db: boolean;
      storage: string | null;
      storage_key: string | null;
    }[];
  }

  async function derivativeRows(imageId: string) {
    const result = await db.query(
      `SELECT key, data IS NOT NULL AS in_db, storage, storage_key
         FROM e_image_derivative_backend WHERE image_id = $1`,
      [imageId],
    );
    return result.rows as {
      key: string;
      in_db: boolean;
      storage: string | null;
      storage_key: string | null;
    }[];
  }

  // The files of an image in the directory, like their keys
  async function diskFiles(imageId: string) {
    const entries = await readdir(join(diskPath, 'images', imageId), {
      recursive: true,
      withFileTypes: true,
    }).catch(() => []);
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) =>
        join(entry.parentPath, entry.name).slice(diskPath.length + 1),
      )
      .sort();
  }

  async function objectKeys(imageId: string) {
    const result = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `${prefix}images/${imageId}/`,
      }),
    );
    return (result.Contents ?? []).map((object) => object.Key!).sort();
  }

  async function getObject(key: string) {
    const result = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    return {
      body: Buffer.from(await result.Body!.transformToByteArray()),
      contentType: result.ContentType,
    };
  }

  it('stores image data where the driver says', async () => {
    const { id } = await client.uploadOk(await makePng(), 'stored.png');
    const [master] = await fileRows(id);

    if (s3IsTarget) {
      expect(master).toMatchObject({
        variant: 'master',
        in_db: false,
        storage_key: `${prefix}images/${id}/master`,
      });
      const object = await getObject(master.storage_key!);
      expect(object.contentType).toBe('image/png');
      const served = await Client.guest().get(`/i/${id}.png`);
      expect(object.body.equals(served.body)).toBe(true);
    } else if (diskIsTarget) {
      expect(master).toMatchObject({
        variant: 'master',
        in_db: false,
        storage: 'filesystem',
        storage_key: `images/${id}/master`,
      });
      if (diskConfigured) {
        const file = await readFile(join(diskPath, master.storage_key!));
        const served = await Client.guest().get(`/i/${id}.png`);
        expect(file.equals(served.body)).toBe(true);
      }
    } else {
      expect(master).toMatchObject({
        variant: 'master',
        in_db: true,
        storage: null,
        storage_key: null,
      });
    }
  });

  it('stores originals and cached conversions the same way', async () => {
    const user = await Client.admin();
    expectSuccess(
      await user.post('/api/pref/usr/keep_original', { value: true }),
    );
    try {
      const jpeg = await makeJpeg();
      const { id } = await user.uploadOk(jpeg, 'original.jpg');
      expect((await Client.guest().get(`/i/${id}.webp?width=10`)).status).toBe(
        200,
      );

      const files = await fileRows(id);
      const derivatives = await derivativeRows(id);
      expect(files.map((f) => f.variant)).toEqual(['master', 'original']);
      expect(derivatives).toHaveLength(1);

      for (const row of [...files, ...derivatives]) {
        expect(row.in_db).toBe(target === 'database');
        expect(row.storage).toBe(target === 'database' ? null : target);
        expect(row.storage_key !== null).toBe(target !== 'database');
      }

      if (s3IsTarget) {
        expect(await objectKeys(id)).toEqual(
          [
            `${prefix}images/${id}/derivatives/${derivatives[0].key}`,
            `${prefix}images/${id}/master`,
            `${prefix}images/${id}/original`,
          ].sort(),
        );
        const original = await getObject(`${prefix}images/${id}/original`);
        expect(original.body.equals(jpeg)).toBe(true);
      }
      if (diskIsTarget && diskConfigured) {
        expect(await diskFiles(id)).toEqual(
          [
            `images/${id}/derivatives/${derivatives[0].key}`,
            `images/${id}/master`,
            `images/${id}/original`,
          ].sort(),
        );
        const original = await readFile(
          join(diskPath, `images/${id}/original`),
        );
        expect(original.equals(jpeg)).toBe(true);
      }
    } finally {
      expectSuccess(
        await user.post('/api/pref/usr/keep_original', { value: false }),
      );
    }
  });

  it('does not store copies of the master', async () => {
    const { id } = await client.uploadOk(await makePng());
    const res = await Client.guest().get(`/i/${id}.png`);
    expect(res.status).toBe(200);
    expect(res.body.subarray(1, 4).toString()).toBe('PNG');
    expect(await derivativeRows(id)).toEqual([]);

    // Also for a still WebP, whose extension is the same as an animated one
    const webp = await sharp(await makePng())
      .webp()
      .toBuffer();
    const still = await client.uploadOk(webp, 'still.webp');
    const served = await Client.guest().get(`/i/${still.id}.webp`);
    expect(served.body.equals(webp)).toBe(true);
    expect(await derivativeRows(still.id)).toEqual([]);
  });

  it('keeps at most 50 cached conversions per image', async () => {
    const { id } = await client.uploadOk(await makePng(20, 20));
    for (let width = 1; width <= 55; width++) {
      const res = await Client.guest().get(`/i/${id}.png?width=${width}`);
      expect(res.status).toBe(200);
      expect((await sharp(res.body).metadata()).width).toBe(width);
    }
    expect(await derivativeRows(id)).toHaveLength(50);
  });

  it('deletes the stored data along with the image', async () => {
    const { id } = await client.uploadOk(await makePng());
    await Client.guest().get(`/i/${id}.jpg`);

    expectSuccess(await client.post('/api/image/delete', { ids: [id] }));

    expect(await fileRows(id)).toEqual([]);
    expect(await derivativeRows(id)).toEqual([]);
    if (s3Configured) expect(await objectKeys(id)).toEqual([]);
    if (diskConfigured) expect(await diskFiles(id)).toEqual([]);
  });

  it('deletes the stored data of deleted users', async () => {
    const user = await createUser(client);
    const { id } = await user.client.uploadOk(await makePng());
    await Client.guest().get(`/i/${id}.jpg`);
    const kept = await client.uploadOk(await makePng());

    expectSuccess(await client.post('/api/user/delete', { id: user.id }));

    expect(await fileRows(id)).toEqual([]);
    expect(await derivativeRows(id)).toEqual([]);
    // The bucket and the directory are cleaned up after the response
    if (s3Configured) await expect.poll(() => objectKeys(id)).toEqual([]);
    if (diskConfigured) await expect.poll(() => diskFiles(id)).toEqual([]);
    expect(await fileRows(kept.id)).toHaveLength(1);
  });

  it('deletes the images of users that were deleted by Picsur 0.5', async () => {
    const { id } = await client.uploadOk(await makePng());
    await Client.guest().get(`/i/${id}.webp`);
    const kept = await client.uploadOk(await makePng());
    // Picsur 0.5 deleted users without their images
    await db.query('UPDATE e_image_backend SET user_id = $1 WHERE id = $2', [
      randomUUID(),
      id,
    ]);

    const meta = expectSuccess(await Client.guest().get(`/i/meta/${id}`));
    expect(meta.user).toBeNull();

    const dryRun = await cli(['images', 'delete-orphaned', '--dry-run']);
    expect(dryRun.code, dryRun.output).toBe(0);
    expect(dryRun.output).toContain(
      'Would delete 1 images of 1 users that no longer exist',
    );
    expect((await Client.guest().get(`/i/${id}.png`)).status).toBe(200);

    const run = await cli(['images', 'delete-orphaned']);
    expect(run.code, run.output).toBe(0);
    expect(run.output).toContain('Deleted 1 images');
    expectFailure(await Client.guest().get(`/i/meta/${id}`), 404, 'notfound');
    expect(await fileRows(id)).toEqual([]);
    expect(await derivativeRows(id)).toEqual([]);
    if (s3Configured) expect(await objectKeys(id)).toEqual([]);
    if (diskConfigured) expect(await diskFiles(id)).toEqual([]);
    expectSuccess(await Client.guest().get(`/i/meta/${kept.id}`));

    const again = await cli(['images', 'delete-orphaned']);
    expect(again.output).toContain('Deleted 0 images');
  });

  it('handles images deleted while they are being converted', async () => {
    const { id } = await client.uploadOk(await makeJpeg(1200, 900), 'gone.jpg');
    // Converting takes long enough for the delete to happen in between
    const converting = Client.guest().get(`/i/${id}.avif?width=1100`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expectSuccess(await client.post('/api/image/delete', { ids: [id] }));

    // Either it finished first, or the image is gone, but nothing broke
    expect([200, 404]).toContain((await converting).status);
    const rows = await db.query(
      'SELECT count(*)::int AS n FROM e_image_derivative_backend WHERE image_id = $1',
      [id],
    );
    expect(rows.rows[0].n).toBe(0);
    if (s3Configured) expect(await objectKeys(id)).toEqual([]);
    if (diskConfigured) expect(await diskFiles(id)).toEqual([]);
  });

  // Deletes what is stored for a row behind Picsur's back
  async function deleteStored(key: string) {
    if (s3IsTarget) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    } else {
      await rm(join(diskPath, key));
    }
  }

  it.runIf(s3IsTarget || (diskIsTarget && diskConfigured))(
    'makes cached conversions again when their data went missing',
    async () => {
      const { id } = await client.uploadOk(await makePng(40, 20));
      const first = await Client.guest().get(`/i/${id}.png?width=20`);
      const [derivative] = await derivativeRows(id);

      await deleteStored(derivative.storage_key!);

      const again = await Client.guest().get(`/i/${id}.png?width=20`);
      expect(again.status).toBe(200);
      expect(again.body.equals(first.body)).toBe(true);
      const stored = s3IsTarget ? await objectKeys(id) : await diskFiles(id);
      expect(stored).toContain(derivative.storage_key);
    },
  );

  it.runIf(s3IsTarget || (diskIsTarget && diskConfigured))(
    'answers with the placeholder when the image data went missing',
    async () => {
      const { id } = await client.uploadOk(await makePng());
      const [master] = await fileRows(id);
      await deleteStored(master.storage_key!);
      const res = await Client.guest().get(`/i/${id}.png`);
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toBe('image/png');

      // It can't be migrated anymore, so don't leave it around for the tests
      // of the migration
      expectSuccess(await client.post('/api/image/delete', { ids: [id] }));
    },
  );

  describe.runIf(s3Configured)('the storage command line tool', () => {
    it('moves image data between the database and the bucket', async () => {
      const images = await Promise.all(
        [makePng(30, 30), makePng(50, 40)].map(async (png) =>
          client.uploadOk(await png),
        ),
      );
      const before = await Promise.all(
        images.map(
          async ({ id }) => (await Client.guest().get(`/i/${id}.png`)).body,
        ),
      );

      const toDatabase = await cli(['storage', 'migrate'], {
        PICSUR_STORAGE_DRIVER: 'database',
      });
      expect(toDatabase.code, toDatabase.output).toBe(0);
      for (const { id } of images) {
        expect((await fileRows(id))[0]).toMatchObject({
          in_db: true,
          storage_key: null,
        });
        // Cached conversions in the bucket were dropped
        expect(await derivativeRows(id)).toEqual([]);
        expect(await objectKeys(id)).toEqual([]);
      }

      const status = await cli(['storage', 'status'], {
        PICSUR_STORAGE_DRIVER: 'database',
      });
      expect(status.output).toMatch(
        /Image files: \d+ in the database, 0 in S3, \d+ on disk/,
      );

      // Still served, whatever the server itself is configured with
      for (const [i, { id }] of images.entries()) {
        const res = await Client.guest().get(`/i/${id}.png`);
        const [a, b] = await Promise.all(
          [res.body, before[i]].map((buf) => sharp(buf).raw().toBuffer()),
        );
        expect(a.equals(b)).toBe(true);
      }

      const toBucket = await cli(['storage', 'migrate'], {
        PICSUR_STORAGE_DRIVER: 's3',
      });
      expect(toBucket.code, toBucket.output).toBe(0);
      expect(toBucket.output).toContain('VACUUM FULL');
      for (const { id } of images) {
        expect((await fileRows(id))[0]).toMatchObject({
          in_db: false,
          storage_key: `${prefix}images/${id}/master`,
        });
        expect((await Client.guest().get(`/i/${id}.webp`)).status).toBe(200);
      }

      // Running it again has nothing left to do
      const again = await cli(['storage', 'migrate'], {
        PICSUR_STORAGE_DRIVER: 's3',
      });
      expect(again.output).toContain('moved 0 files');
    });

    it('cleans up objects that no image uses', async () => {
      const { id } = await client.uploadOk(await makePng());
      const orphanImage = randomUUID();
      const orphans = [
        `${prefix}images/${orphanImage}/master`,
        `${prefix}images/${orphanImage}/derivatives/abc`,
        `${prefix}images/${id}/derivatives/not-in-the-database`,
      ];
      for (const key of orphans) {
        await s3.send(
          new PutObjectCommand({ Bucket: bucket, Key: key, Body: 'x' }),
        );
      }
      // Not ours, must not be touched
      const foreign = `${prefix}images/not-a-picsur-image/file`;
      await s3.send(
        new PutObjectCommand({ Bucket: bucket, Key: foreign, Body: 'x' }),
      );

      // Too young to be collected by default
      const young = await cli(['storage', 'gc']);
      expect(young.code, young.output).toBe(0);
      expect(young.output).toContain('Deleted 0 unused files');

      const dryRun = await cli([
        'storage',
        'gc',
        '--dry-run',
        '--min-age',
        '0',
      ]);
      expect(dryRun.output).toContain('Would delete 3 unused files');
      expect(await objectKeys(orphanImage)).toHaveLength(2);

      const gc = await cli(['storage', 'gc', '--min-age', '0']);
      expect(gc.code, gc.output).toBe(0);
      expect(gc.output).toContain('Deleted 3 unused files');
      expect(await objectKeys(orphanImage)).toEqual([]);
      expect(await objectKeys(id)).toEqual([`${prefix}images/${id}/master`]);
      expect((await Client.guest().get(`/i/${id}.png`)).status).toBe(200);

      const kept = await s3.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: foreign }),
      );
      expect(kept.KeyCount).toBe(1);
    });

    it('explains how to use it', async () => {
      const help = await cli(['--help']);
      expect(help.code).toBe(0);
      expect(help.output).toContain('storage migrate');
      expect(help.output).toContain('images delete-orphaned');
      const wrong = await cli(['nonsense']);
      expect(wrong.code).toBe(1);
    });
  });
  describe.runIf(diskIsTarget && diskConfigured)(
    'the storage command line tool, with a directory',
    () => {
      it('moves image data between the database and the directory', async () => {
        const images = await Promise.all(
          [makePng(30, 30), makePng(50, 40)].map(async (png) =>
            client.uploadOk(await png),
          ),
        );

        const toDatabase = await cli(['storage', 'migrate'], {
          PICSUR_STORAGE_DRIVER: 'database',
        });
        expect(toDatabase.code, toDatabase.output).toBe(0);
        for (const { id } of images) {
          expect((await fileRows(id))[0]).toMatchObject({
            in_db: true,
            storage: null,
            storage_key: null,
          });
          expect(await diskFiles(id)).toEqual([]);
        }
        const status = await cli(['storage', 'status'], {
          PICSUR_STORAGE_DRIVER: 'database',
        });
        expect(status.output).toMatch(
          /Image files: \d+ in the database, 0 in S3, 0 on disk/,
        );

        const toDisk = await cli(['storage', 'migrate']);
        expect(toDisk.code, toDisk.output).toBe(0);
        for (const { id } of images) {
          expect((await fileRows(id))[0]).toMatchObject({
            in_db: false,
            storage: 'filesystem',
            storage_key: `images/${id}/master`,
          });
          expect(await diskFiles(id)).toEqual([`images/${id}/master`]);
          expect((await Client.guest().get(`/i/${id}.webp`)).status).toBe(200);
        }
      });

      it('cleans up files that no image uses', async () => {
        const { id } = await client.uploadOk(await makePng());
        const orphanImage = randomUUID();
        const orphans = [
          `images/${orphanImage}/master`,
          `images/${orphanImage}/derivatives/abc`,
          `images/${id}/derivatives/not-in-the-database`,
          // Left behind by a write that never finished
          `images/${id}/master.${randomUUID()}.tmp`,
        ];
        // Not ours, must not be touched
        const foreign = 'images/not-a-picsur-image/file';
        for (const key of [...orphans, foreign]) {
          await mkdir(dirname(join(diskPath, key)), { recursive: true });
          await writeFile(join(diskPath, key), 'x');
        }

        // Too young to be collected by default
        const young = await cli(['storage', 'gc']);
        expect(young.code, young.output).toBe(0);
        expect(young.output).toContain('Deleted 0 unused files');

        const dryRun = await cli([
          'storage',
          'gc',
          '--dry-run',
          '--min-age',
          '0',
        ]);
        expect(dryRun.output).toContain('Would delete 4 unused files');
        expect(await diskFiles(orphanImage)).toHaveLength(2);

        const gc = await cli(['storage', 'gc', '--min-age', '0']);
        expect(gc.code, gc.output).toBe(0);
        expect(gc.output).toContain('Deleted 4 unused files');
        expect(await diskFiles(orphanImage)).toEqual([]);
        expect(await diskFiles(id)).toEqual([`images/${id}/master`]);
        expect((await Client.guest().get(`/i/${id}.png`)).status).toBe(200);
        expect(await readFile(join(diskPath, foreign), 'utf8')).toBe('x');
      });
    },
  );
});
