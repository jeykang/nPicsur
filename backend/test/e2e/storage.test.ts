import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { spawnBackend } from './helpers/backend.js';
import { Client, expectSuccess } from './helpers/client.js';
import { makeJpeg, makePng } from './helpers/images.js';

const env = inject('serverEnv');
const s3Configured = env['PICSUR_S3_BUCKET'] !== undefined;
const s3IsTarget = env['PICSUR_STORAGE_DRIVER'] === 's3';

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
      `SELECT variant, data IS NOT NULL AS in_db, storage_key
         FROM e_image_file_backend WHERE image_id = $1 ORDER BY variant`,
      [imageId],
    );
    return result.rows as {
      variant: string;
      in_db: boolean;
      storage_key: string | null;
    }[];
  }

  async function derivativeRows(imageId: string) {
    const result = await db.query(
      `SELECT key, data IS NOT NULL AS in_db, storage_key
         FROM e_image_derivative_backend WHERE image_id = $1`,
      [imageId],
    );
    return result.rows as {
      key: string;
      in_db: boolean;
      storage_key: string | null;
    }[];
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
      expect(object.contentType).toBe('image/x-qoi');
      const served = await Client.guest().get(`/i/${id}.qoi`);
      expect(object.body.equals(served.body)).toBe(true);
    } else {
      expect(master).toMatchObject({
        variant: 'master',
        in_db: true,
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
        expect(row.in_db).toBe(!s3IsTarget);
        expect(row.storage_key !== null).toBe(s3IsTarget);
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
    } finally {
      expectSuccess(
        await user.post('/api/pref/usr/keep_original', { value: false }),
      );
    }
  });

  it('does not store copies of the master', async () => {
    const { id } = await client.uploadOk(await makePng());
    const res = await Client.guest().get(`/i/${id}.qoi`);
    expect(res.status).toBe(200);
    expect(res.body.subarray(0, 4).toString()).toBe('qoif');
    expect(await derivativeRows(id)).toEqual([]);
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
  });

  it.runIf(s3IsTarget)(
    'makes cached conversions again when their data went missing',
    async () => {
      const { id } = await client.uploadOk(await makePng(40, 20));
      const first = await Client.guest().get(`/i/${id}.png?width=20`);
      const [derivative] = await derivativeRows(id);

      await s3.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: derivative.storage_key!,
        }),
      );

      const again = await Client.guest().get(`/i/${id}.png?width=20`);
      expect(again.status).toBe(200);
      expect(again.body.equals(first.body)).toBe(true);
      expect(await objectKeys(id)).toContain(derivative.storage_key);
    },
  );

  it.runIf(s3IsTarget)(
    'answers with the placeholder when the image data went missing',
    async () => {
      const { id } = await client.uploadOk(await makePng());
      await s3.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: `${prefix}images/${id}/master`,
        }),
      );
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
        /Image files: \d+ in the database, 0 in object storage/,
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
      expect(young.output).toContain('Deleted 0 unused objects');

      const dryRun = await cli([
        'storage',
        'gc',
        '--dry-run',
        '--min-age',
        '0',
      ]);
      expect(dryRun.output).toContain('Would delete 3 unused objects');
      expect(await objectKeys(orphanImage)).toHaveLength(2);

      const gc = await cli(['storage', 'gc', '--min-age', '0']);
      expect(gc.code, gc.output).toBe(0);
      expect(gc.output).toContain('Deleted 3 unused objects');
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
      const wrong = await cli(['nonsense']);
      expect(wrong.code).toBe(1);
    });
  });
});
