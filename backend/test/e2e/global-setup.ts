// Global setup for the end-to-end test suite.
//
// Every run gets a brand new Postgres database (and, when testing the S3
// storage driver, a brand new bucket), boots the compiled backend
// (dist/main.js) against it as a child process, and tears everything down
// again afterwards. Nothing that already exists is ever touched.
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
//       storage driver.
//
// The backend's log output is written to test/e2e/.output/server.log.

import { spawn, type ChildProcess } from 'node:child_process';
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
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { TestProject } from 'vitest/node';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

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
  const runId = `${Date.now()}_${randomBytes(3).toString('hex')}`;
  const database = `picsur_e2e_${runId}`;

  const workDir = join(tmpdir(), `picsur-e2e-${runId}`);
  const frontendRoot = join(workDir, 'frontend');
  mkdirSync(frontendRoot, { recursive: true });
  // A stand-in for the compiled Angular app, so the backend can be tested
  // without building the frontend first.
  writeFileSync(
    join(frontendRoot, 'index.html'),
    '<!doctype html><html><body>picsur-e2e</body></html>',
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

  const extraEnv = JSON.parse(process.env['E2E_SERVER_ENV'] ?? '{}');

  const serverEnv: Record<string, string> = {
    PATH: process.env['PATH'] ?? '',
    HOME: process.env['HOME'] ?? '',
    TZ: 'UTC',
    PICSUR_HOST: '127.0.0.1',
    PICSUR_PORT: String(port),
    PICSUR_DB_HOST: db.host,
    PICSUR_DB_PORT: String(db.port),
    PICSUR_DB_USERNAME: db.user,
    PICSUR_DB_PASSWORD: db.password,
    PICSUR_DB_DATABASE: database,
    PICSUR_ADMIN_PASSWORD: ADMIN_PASSWORD,
    PICSUR_JWT_SECRET: randomBytes(32).toString('hex'),
    PICSUR_STATIC_FRONTEND_ROOT: frontendRoot,
    // Run the real migrations instead of TypeORM's schema synchronisation
    PICSUR_PRODUCTION: 'true',
    PICSUR_VERBOSE: 'true',
    PICSUR_MAX_FILE_SIZE: String(MAX_FILE_SIZE),
    PICSUR_CONVERSION_RATE_LIMIT: String(CONVERSION_RATE_LIMIT),
    ...extraEnv,
  };

  const child = spawn(
    process.env['E2E_NODE'] ?? process.execPath,
    ['dist/main.js'],
    {
      cwd: backendRoot,
      env: serverEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  const logStream = createWriteStream(serverLog);
  child.stdout?.pipe(logStream);
  child.stderr?.pipe(logStream);

  try {
    await waitForServer(baseUrl, child, 60_000);
  } catch (e) {
    child.kill('SIGKILL');
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

  return async () => {
    const exited = new Promise((r) => child.once('exit', r));
    child.kill('SIGTERM');
    const killTimer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    await exited;
    clearTimeout(killTimer);
    await new Promise((r) => logStream.end(r));

    await withMaintenanceClient((client) =>
      client.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`),
    );

    rmSync(workDir, { recursive: true, force: true });
  };
}
