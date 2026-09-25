// Global setup for the end-to-end test suite.
//
// Every run gets a brand new Postgres database (and, when testing object
// storage, a brand new bucket), boots the compiled backend (dist/main.js)
// against it as a child process, and tears everything down again afterwards.
// Nothing that already exists is ever touched.
//
// Configuration (all optional):
//   E2E_DB_HOST / E2E_DB_PORT / E2E_DB_USERNAME / E2E_DB_PASSWORD
//       Postgres server to create the throwaway database on. The user needs
//       the CREATEDB privilege. Defaults to picsur:picsur@localhost:5432.
//   E2E_NODE
//       Node binary used to run the backend, defaults to the one running the
//       tests.
//   E2E_SERVER_ENV
//       Extra environment for the backend as a JSON object, e.g. to select a
//       storage driver. When it configures object storage without naming a
//       bucket, a new bucket is used.
//   E2E_DOCKER_IMAGE
//       Test this Docker image instead of dist/main.js. The container uses
//       the host's network, and serves the frontend built into the image.
//   E2E_FULL_CODECS
//       Also test HEIC, JPEG XL and JPEG 2000, which need a libvips built
//       with every codec like the one in the Docker image. On by default when
//       testing a Docker image.
//   E2E_S3_ENV
//       An S3 compatible service the tests may use, in the same form as
//       E2E_SERVER_ENV. Used to test setting up object storage on the
//       settings page, when the server is not configured to use it already.
//
// The backend's log output is written to test/e2e/.output/server.log.

import {
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  createWriteStream,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { backendRoot, spawnBackend } from './helpers/backend.js';

export const ADMIN_PASSWORD = 'e2e-admin-password';
export const MAX_FILE_SIZE = 5 * 1000 * 1000;
export const CONVERSION_RATE_LIMIT = 30;

declare module 'vitest' {
  export interface ProvidedContext {
    baseUrl: string;
    adminPassword: string;
    maxFileSize: number;
    serverLog: string;
    // The environment the backend runs with, for tests that need to look at
    // the database or bucket directly, or run the command line tool
    serverEnv: Record<string, string>;
    // The Docker image being tested, if any
    dockerImage: string | null;
    // Whether the server can handle HEIC, JPEG XL and JPEG 2000
    fullCodecs: boolean;
    // PICSUR_S3_* settings of a service the tests may use, if any
    s3TestEnv: Record<string, string> | null;
  }
}

function dbConfig() {
  return {
    host: process.env['E2E_DB_HOST'] ?? 'localhost',
    port: Number(process.env['E2E_DB_PORT'] ?? 5432),
    user: process.env['E2E_DB_USERNAME'] ?? 'picsur',
    password: process.env['E2E_DB_PASSWORD'] ?? 'picsur',
  };
}

async function withMaintenanceClient<T>(
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ ...dbConfig(), database: 'postgres' });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

// Empties and removes a bucket that was created for this run
async function deleteBucket(env: Record<string, string>) {
  const s3 = new S3Client({
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
  const Bucket = env['PICSUR_S3_BUCKET'];
  try {
    for (;;) {
      const list = await s3.send(new ListObjectsV2Command({ Bucket }));
      const keys = (list.Contents ?? []).map((object) => ({ Key: object.Key }));
      if (keys.length === 0) break;
      await s3.send(
        new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys } }),
      );
    }
    await s3.send(new DeleteBucketCommand({ Bucket }));
  } catch (e) {
    console.warn(`Could not remove the test bucket ${Bucket}:`, e);
  } finally {
    s3.destroy();
  }
}

async function getFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Could not determine a free port'));
        return;
      }
      server.close(() => resolvePort(address.port));
    });
  });
}

async function waitForServer(
  baseUrl: string,
  child: ChildProcess,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Backend exited early with code ${child.exitCode}`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/info`);
      if (res.ok) return;
    } catch {
      // Not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Backend did not become ready within ${timeoutMs}ms`);
}

export default async function setup(project: TestProject) {
  const runId = `${Date.now()}-${randomBytes(3).toString('hex')}`;
  const database = `picsur_e2e_${runId.replace('-', '_')}`;
  const dockerImage = process.env['E2E_DOCKER_IMAGE'] || null;
  const fullCodecs =
    process.env['E2E_FULL_CODECS'] !== undefined
      ? process.env['E2E_FULL_CODECS'] === 'true'
      : dockerImage !== null;
  const containerName = `picsur-e2e-${runId}`;

  const workDir = join(tmpdir(), `picsur-e2e-${runId}`);
  const frontendRoot = join(workDir, 'frontend');
  mkdirSync(frontendRoot, { recursive: true });
  // A stand-in for the compiled Angular app, so the backend can be tested
  // without building the frontend first.
  writeFileSync(
    join(frontendRoot, 'index.html'),
    '<!doctype html><html><body><app-root>picsur-e2e</app-root></body></html>',
  );

  const outputDir = join(backendRoot, 'test/e2e/.output');
  mkdirSync(outputDir, { recursive: true });
  const serverLog = join(outputDir, 'server.log');

  await withMaintenanceClient((client) =>
    client.query(`CREATE DATABASE "${database}"`),
  );

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const db = dbConfig();

  const extraEnv: Record<string, string> = JSON.parse(
    process.env['E2E_SERVER_ENV'] ?? '{}',
  );
  const usesObjectStorage = Object.keys(extraEnv).some((key) =>
    key.startsWith('PICSUR_S3_'),
  );
  const newBucket =
    usesObjectStorage && extraEnv['PICSUR_S3_BUCKET'] === undefined;
  if (newBucket) extraEnv['PICSUR_S3_BUCKET'] = `picsur-e2e-${runId}`;

  const serverEnv: Record<string, string> = {
    TZ: 'UTC',
    PICSUR_HOST: '127.0.0.1',
    PICSUR_PORT: String(port),
    PICSUR_DB_HOST: db.host,
    PICSUR_DB_PORT: String(db.port),
    PICSUR_DB_USERNAME: db.user,
    PICSUR_DB_PASSWORD: db.password,
    PICSUR_DB_DATABASE: database,
    PICSUR_ADMIN_PASSWORD: ADMIN_PASSWORD,
    // Short on purpose, like the example value many instances use. A short
    // secret used to break the settings page.
    PICSUR_JWT_SECRET: 'CHANGE_ME',
    // The Docker image serves the frontend that was built into it
    ...(dockerImage === null
      ? { PICSUR_STATIC_FRONTEND_ROOT: frontendRoot }
      : {}),
    // Run the real migrations instead of TypeORM's schema synchronisation
    PICSUR_PRODUCTION: 'true',
    PICSUR_VERBOSE: 'true',
    PICSUR_MAX_FILE_SIZE: String(MAX_FILE_SIZE),
    PICSUR_CONVERSION_RATE_LIMIT: String(CONVERSION_RATE_LIMIT),
    ...extraEnv,
  };

  const child = spawnBackend('main', [], serverEnv, dockerImage, containerName);

  const logStream = createWriteStream(serverLog);
  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);

  // Stopping the docker client does not always stop the container
  const removeContainer = () => {
    if (dockerImage !== null) {
      spawnSync('docker', ['rm', '--force', containerName], {
        stdio: 'ignore',
      });
    }
  };

  try {
    // Pulling or starting a container can take a while
    await waitForServer(
      baseUrl,
      child,
      dockerImage === null ? 60_000 : 180_000,
    );
  } catch (e) {
    child.kill('SIGKILL');
    removeContainer();
    await new Promise((r) => logStream.end(r));
    console.error(
      readFileSync(serverLog, 'utf8').split('\n').slice(-50).join('\n'),
    );
    await withMaintenanceClient((client) =>
      client.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`),
    );
    throw e;
  }

  project.provide('baseUrl', baseUrl);
  project.provide('adminPassword', ADMIN_PASSWORD);
  project.provide('maxFileSize', MAX_FILE_SIZE);
  project.provide('serverLog', serverLog);
  project.provide('serverEnv', serverEnv);
  project.provide('dockerImage', dockerImage);
  project.provide('fullCodecs', fullCodecs);
  project.provide(
    's3TestEnv',
    process.env['E2E_S3_ENV'] ? JSON.parse(process.env['E2E_S3_ENV']) : null,
  );

  return async () => {
    const exited =
      child.exitCode !== null || child.signalCode !== null
        ? Promise.resolve()
        : new Promise((r) => child.once('exit', r));
    if (dockerImage !== null) {
      spawnSync('docker', ['stop', '--time=10', containerName], {
        stdio: 'ignore',
      });
    }
    child.kill('SIGTERM');
    const killTimer = setTimeout(() => {
      child.kill('SIGKILL');
      removeContainer();
    }, 15_000);
    await exited;
    clearTimeout(killTimer);
    await new Promise((r) => logStream.end(r));

    await withMaintenanceClient((client) =>
      client.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`),
    );
    if (newBucket) await deleteBucket(serverEnv);

    rmSync(workDir, { recursive: true, force: true });
  };
}
