import {
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { spawnBackend } from './helpers/backend.js';
import {
  Client,
  createUser,
  expectFailure,
  expectSuccess,
} from './helpers/client.js';
import { makePng } from './helpers/images.js';

const env = inject('serverEnv');
const s3TestEnv = inject('s3TestEnv');
// Storage set with environment variables can not be changed on the page
const storageFromEnv = Object.keys(env).some(
  (key) => key === 'PICSUR_STORAGE_DRIVER' || key.startsWith('PICSUR_S3_'),
);

interface SettingState {
  key: string;
  value: string | null;
  set: boolean;
  default: string | null;
  source: 'environment' | 'settings' | 'default';
  saved: boolean;
  env: string;
}

interface SettingsResponse {
  settings: SettingState[];
  restart_needed: boolean;
  restart_error: string | null;
  started_at: string;
  can_save_secrets: boolean;
}

interface StorageResponse {
  driver: 'database' | 's3';
  bucket: string | null;
  files: { database: number; object_storage: number };
  derivatives: { database: number; object_storage: number };
  migration: {
    running: boolean;
    stopped: boolean;
    target: 'database' | 's3' | null;
    total: number;
    moved: number;
    failed: number;
    error: string | null;
  };
}

function setting(settings: SettingsResponse, key: string): SettingState {
  const state = settings.settings.find((s) => s.key === key);
  if (state === undefined) throw new Error(`No setting ${key}`);
  return state;
}

async function getSettings(client: Client): Promise<SettingsResponse> {
  return expectSuccess(await client.get('/api/server/settings'));
}

async function getStorage(client: Client): Promise<StorageResponse> {
  return expectSuccess(await client.get('/api/server/storage'));
}

async function update(client: Client, values: Record<string, string | null>) {
  return client.post('/api/server/settings', { values });
}

// Restarts the server, and waits until it is back
async function restart(client: Client): Promise<SettingsResponse> {
  const before = expectSuccess(await client.post('/api/server/restart'))
    .started_at as string;

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    const res = await client.get('/api/server/settings').catch(() => null);
    if (res?.json?.success && res.json.data.started_at !== before) {
      return res.json.data;
    }
  }
  throw new Error('Picsur did not come back after restarting');
}

async function migrate(client: Client): Promise<StorageResponse> {
  expectSuccess(await client.post('/api/server/storage/migrate'));
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const storage = await getStorage(client);
    if (!storage.migration.running) return storage;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Moving images did not finish');
}

function serverLog(): string {
  return readFileSync(inject('serverLog'), 'utf8');
}

// Runs the command line tool against the test database
function cli(args: string[]) {
  return new Promise<{ code: number; output: string }>((done) => {
    const child = spawnBackend('cli', args, env, inject('dockerImage'));
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('close', (code) => done({ code: code ?? -1, output }));
  });
}

describe('server settings', () => {
  let admin: Client;
  let db: pg.Client;

  beforeAll(async () => {
    admin = await Client.admin();
    db = new pg.Client({
      host: env['PICSUR_DB_HOST'],
      port: Number(env['PICSUR_DB_PORT']),
      user: env['PICSUR_DB_USERNAME'],
      password: env['PICSUR_DB_PASSWORD'],
      database: env['PICSUR_DB_DATABASE'],
    });
    await db.connect();
  });

  afterAll(async () => {
    await db.end();
  });

  async function storedValue(key: string): Promise<string | null> {
    const result = await db.query(
      'SELECT "value" FROM e_server_setting_backend WHERE "key" = $1',
      [key],
    );
    return result.rows[0]?.value ?? null;
  }

  it('are only for admins', async () => {
    const { client } = await createUser(admin);
    for (const user of [client, Client.guest()]) {
      expectFailure(await user.get('/api/server/settings'), 403, 'permission');
      expectFailure(
        await user.post('/api/server/settings', { values: {} }),
        403,
        'permission',
      );
      expectFailure(await user.post('/api/server/restart'), 403, 'permission');
      expectFailure(await user.get('/api/server/storage'), 403, 'permission');
      expectFailure(
        await user.post('/api/server/storage/migrate'),
        403,
        'permission',
      );
    }
  });

  it('lists every setting, with where it comes from', async () => {
    const settings = await getSettings(admin);
    expect(settings.restart_needed).toBe(false);
    expect(settings.restart_error).toBeNull();

    // Set by the test setup
    expect(setting(settings, 'max_file_size')).toMatchObject({
      value: env['PICSUR_MAX_FILE_SIZE'],
      set: true,
      source: 'environment',
      saved: true,
      env: 'PICSUR_MAX_FILE_SIZE',
    });
    expect(setting(settings, 'max_concurrent_conversions')).toMatchObject({
      value: null,
      set: false,
      source: 'default',
      saved: false,
    });
    expect(setting(settings, 's3_region').default).toBe('us-east-1');
    expect(settings.can_save_secrets).toBe(true);
  });

  it('saves settings from the environment, to take them over later', async () => {
    expect(await storedValue('max_file_size')).toBe(
      env['PICSUR_MAX_FILE_SIZE'],
    );
    expect(await storedValue('conversion_rate_limit')).toBe(
      env['PICSUR_CONVERSION_RATE_LIMIT'],
    );
    expect(await storedValue('max_concurrent_conversions')).toBeNull();
  });

  it('never shows secrets, and only saves them encrypted', async () => {
    const secret = setting(await getSettings(admin), 's3_secret_access_key');
    expect(secret.value).toBeNull();

    const fromEnv = env['PICSUR_S3_SECRET_ACCESS_KEY'];
    expect(secret.set).toBe(fromEnv !== undefined);
    if (fromEnv !== undefined) {
      const stored = await storedValue('s3_secret_access_key');
      expect(stored).toMatch(/^enc:v1:/);
      expect(stored).not.toContain(fromEnv);
    }
  });

  it('can not change settings from the environment', async () => {
    const res = await update(admin, { max_file_size: '1000000' });
    expectFailure(res, 400, 'usrvalidation');
    expect(res.json.data.message).toContain('PICSUR_MAX_FILE_SIZE');

    // Sending back what is shown is fine
    const settings = expectSuccess(
      await update(admin, { max_file_size: env['PICSUR_MAX_FILE_SIZE'] }),
    );
    expect(settings.restart_needed).toBe(false);
  });

  it('checks values', async () => {
    for (const values of [
      { max_concurrent_conversions: '0' } as Record<string, string>,
      { conversion_rate_limit: 'lots' },
      { trust_proxy: 'my proxy' },
      { not_a_setting: 'value' },
    ]) {
      expectFailure(await update(admin, values), 400, 'usrvalidation');
    }
    expect((await getSettings(admin)).restart_needed).toBe(false);
  });

  it('applies changes when restarting', async () => {
    const changed = expectSuccess(
      await update(admin, { max_concurrent_conversions: '3' }),
    );
    expect(changed.restart_needed).toBe(true);
    expect(setting(changed, 'max_concurrent_conversions')).toMatchObject({
      value: '3',
      source: 'settings',
    });

    const restarted = await restart(admin);
    expect(restarted.restart_needed).toBe(false);
    expect(restarted.restart_error).toBeNull();
    expect(serverLog()).toContain('At most 3 conversions at once');

    // Logins survive restarts
    const { id } = await admin.uploadOk(await makePng());
    expect((await Client.guest().get(`/i/${id}.png`)).status).toBe(200);

    // Back to the default
    expect(
      expectSuccess(await update(admin, { max_concurrent_conversions: null }))
        .restart_needed,
    ).toBe(true);
    expect((await restart(admin)).restart_needed).toBe(false);
  });

  it('moves images with nothing to move', async () => {
    const storage = await migrate(admin);
    expect(storage.migration).toMatchObject({
      running: false,
      failed: 0,
      error: null,
    });
    expect(
      storage.driver === 's3'
        ? storage.files.database
        : storage.files.object_storage,
    ).toBe(0);
  });

  describe.skipIf(!storageFromEnv)('with storage from the environment', () => {
    it('can not change the storage', async () => {
      const res = await update(admin, { s3_bucket: 'another-bucket' });
      expectFailure(res, 400, 'usrvalidation');
      expect(res.json.data.message).toContain('PICSUR_S3_BUCKET');
    });
  });

  describe.skipIf(storageFromEnv)('with storage set here', () => {
    it('needs a bucket to store images in S3', async () => {
      const res = await update(admin, { storage_driver: 's3' });
      expectFailure(res, 400, 'usrvalidation');
      expect(res.json.data.message).toContain('bucket');
    });

    const unreachable = {
      storage_driver: 's3',
      s3_endpoint: 'http://127.0.0.1:9',
      s3_bucket: 'picsur-unreachable',
      s3_force_path_style: 'true',
      s3_access_key_id: 'key',
      s3_secret_access_key: 'secret',
    };

    it('saves secrets encrypted', async () => {
      // Without a bucket nothing is tried out
      const saved = expectSuccess(
        await update(admin, {
          s3_access_key_id: 'e2e-key-id',
          s3_secret_access_key: 'e2e-secret-value',
        }),
      );
      expect(setting(saved, 's3_secret_access_key')).toMatchObject({
        value: null,
        set: true,
        source: 'settings',
        saved: true,
      });
      const stored = await storedValue('s3_secret_access_key');
      expect(stored).toMatch(/^enc:v1:/);
      expect(stored).not.toContain('e2e-secret-value');

      const removed = expectSuccess(
        await update(admin, {
          s3_access_key_id: null,
          s3_secret_access_key: null,
        }),
      );
      expect(setting(removed, 's3_secret_access_key').set).toBe(false);
      expect(removed.restart_needed).toBe(false);
    });

    it('only stores storage that works', async () => {
      const tested = await admin.post('/api/server/settings/test-storage', {
        values: unreachable,
      });
      expectFailure(tested, 500, 'network');
      expect(tested.json.data.message).toContain(
        'Can not access bucket "picsur-unreachable"',
      );

      expectFailure(await update(admin, unreachable), 500, 'network');
      const settings = await getSettings(admin);
      expect(setting(settings, 'storage_driver').source).toBe('default');
      expect(settings.restart_needed).toBe(false);
    });

    it('goes back to the previous settings when the new ones fail', async () => {
      // Settings that could not be saved through the api, except for the
      // credentials, which are saved encrypted
      const { s3_access_key_id, s3_secret_access_key, ...rest } = unreachable;
      expectSuccess(
        await update(admin, { s3_access_key_id, s3_secret_access_key }),
      );
      for (const [key, value] of Object.entries(rest)) {
        await db.query(
          'INSERT INTO e_server_setting_backend ("key", "value") VALUES ($1, $2)',
          [key, value],
        );
      }
      expect((await getSettings(admin)).restart_needed).toBe(true);

      const restarted = await restart(admin);
      expect(restarted.restart_error).toContain(
        'Can not access bucket "picsur-unreachable"',
      );
      expect(restarted.restart_needed).toBe(false);
      expect(setting(restarted, 'storage_driver').source).toBe('default');
      const keys = (
        await db.query('SELECT "key" FROM e_server_setting_backend')
      ).rows.map((row) => row.key);
      for (const key of Object.keys(unreachable)) {
        expect(keys).not.toContain(key);
      }
      expect((await getStorage(admin)).driver).toBe('database');

      // A restart that works clears the error
      expect((await restart(admin)).restart_error).toBeNull();
    });

    describe.skipIf(s3TestEnv === null)('and an S3 service', () => {
      const bucket = `picsur-e2e-settings-${randomBytes(4).toString('hex')}`;
      const nextBucket = `${bucket}-next`;
      const s3Settings = {
        s3_endpoint: s3TestEnv?.['PICSUR_S3_ENDPOINT'] ?? null,
        s3_region: s3TestEnv?.['PICSUR_S3_REGION'] ?? null,
        s3_force_path_style: s3TestEnv?.['PICSUR_S3_FORCE_PATH_STYLE'] ?? null,
        s3_access_key_id: s3TestEnv?.['PICSUR_S3_ACCESS_KEY_ID'] ?? null,
        s3_secret_access_key:
          s3TestEnv?.['PICSUR_S3_SECRET_ACCESS_KEY'] ?? null,
        s3_bucket: bucket,
      };

      afterAll(async () => {
        const s3 = new S3Client({
          region: s3Settings.s3_region ?? 'us-east-1',
          endpoint: s3Settings.s3_endpoint ?? undefined,
          forcePathStyle: s3Settings.s3_force_path_style === 'true',
          credentials: {
            accessKeyId: s3Settings.s3_access_key_id ?? '',
            secretAccessKey: s3Settings.s3_secret_access_key ?? '',
          },
        });
        for (const Bucket of [bucket, nextBucket]) {
          try {
            const list = await s3.send(new ListObjectsV2Command({ Bucket }));
            const keys = (list.Contents ?? []).map((o) => ({ Key: o.Key }));
            if (keys.length > 0) {
              await s3.send(
                new DeleteObjectsCommand({
                  Bucket,
                  Delete: { Objects: keys },
                }),
              );
            }
            await s3.send(new DeleteBucketCommand({ Bucket }));
          } catch {
            // It was not created
          }
        }
        s3.destroy();
      });

      it('moves images to a bucket and back', async () => {
        const { id } = await admin.uploadOk(await makePng(), 'moving.png');
        const image = (await Client.guest().get(`/i/${id}.png`)).body;

        const tested = expectSuccess(
          await admin.post('/api/server/settings/test-storage', {
            values: { ...s3Settings, storage_driver: 's3' },
          }),
        );
        expect(tested).toEqual({ bucket, created: true });

        expectSuccess(
          await update(admin, { ...s3Settings, storage_driver: 's3' }),
        );
        await restart(admin);

        let storage = await getStorage(admin);
        expect(storage).toMatchObject({ driver: 's3', bucket });
        expect(storage.files.database).toBeGreaterThan(0);

        // The command line tool uses the same settings
        const status = await cli(['storage', 'status']);
        expect(status.output).toContain('New images are stored in: s3');

        const files = storage.files.database;
        storage = await migrate(admin);
        expect(storage.migration).toMatchObject({
          target: 's3',
          total: files,
          moved: files,
          failed: 0,
          stopped: false,
          error: null,
        });
        expect(storage.files.database).toBe(0);
        const served = await Client.guest().get(`/i/${id}.png`);
        expect(served.status).toBe(200);
        expect(served.body.equals(image)).toBe(true);

        // What is in the bucket would not be found anymore
        const moved = await update(admin, { s3_bucket: `${bucket}-other` });
        expectFailure(moved, 409, 'conflict');
        expect(moved.json.data.message).toContain(`"${bucket}" still holds`);

        expectSuccess(await update(admin, { storage_driver: null }));
        await restart(admin);
        storage = await migrate(admin);
        expect(storage).toMatchObject({ driver: 'database', bucket });
        expect(storage.files.object_storage).toBe(0);
        expect(storage.derivatives.object_storage).toBe(0);

        // Now the bucket can go
        const removed = expectSuccess(
          await update(
            admin,
            Object.fromEntries(Object.keys(s3Settings).map((k) => [k, null])),
          ),
        );
        expect(removed.restart_needed).toBe(true);
        await restart(admin);
        expect((await getStorage(admin)).bucket).toBeNull();
        expect(
          (await Client.guest().get(`/i/${id}.png`)).body.equals(image),
        ).toBe(true);
      });

      it('does not restart away from a bucket that got used', async () => {
        expectSuccess(
          await update(admin, { ...s3Settings, storage_driver: 's3' }),
        );
        await restart(admin);
        expect((await getStorage(admin)).files.object_storage).toBe(0);

        // Nothing is stored in the bucket yet, so it can still change
        expectSuccess(await update(admin, { s3_bucket: nextBucket }));
        // But then an image is stored in it before restarting
        const { id } = await admin.uploadOk(await makePng());
        const refused = await admin.post('/api/server/restart');
        expectFailure(refused, 409, 'conflict');
        expect(refused.json.data.message).toContain(
          `"${bucket}" still holds 1 image file`,
        );

        // Back to how it was
        expectSuccess(await admin.post('/api/image/delete', { ids: [id] }));
        expectSuccess(
          await update(
            admin,
            Object.fromEntries(
              ['storage_driver', ...Object.keys(s3Settings)].map((k) => [
                k,
                null,
              ]),
            ),
          ),
        );
        await restart(admin);
        expect(await getStorage(admin)).toMatchObject({
          driver: 'database',
          bucket: null,
        });
      });
    });
  });
});
