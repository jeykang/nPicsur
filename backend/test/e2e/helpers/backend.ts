import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

export const backendRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

// The memory settings the Docker image starts the server with
const MainNodeOptions = ['--max-semi-space-size=16', '--expose-gc'];

// Starts one of the backend's entry points (dist/main.js or dist/cli.js),
// either from the local build or from the Docker image being tested. The
// container shares the host's network, so it reaches the database and the
// bucket at the same addresses the tests use.
export function spawnBackend(
  script: 'main' | 'cli',
  args: string[],
  env: Record<string, string>,
  dockerImage: string | null,
  containerName?: string,
): ChildProcessByStdio<null, Readable, Readable> {
  if (dockerImage === null) {
    return spawn(
      process.env['E2E_NODE'] ?? process.execPath,
      [
        ...(script === 'main' ? MainNodeOptions : []),
        `dist/${script}.js`,
        ...args,
      ],
      {
        cwd: backendRoot,
        env: {
          PATH: process.env['PATH'] ?? '',
          HOME: process.env['HOME'] ?? '',
          ...env,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  }

  return spawn(
    'docker',
    [
      'run',
      '--rm',
      '--network=host',
      ...(containerName !== undefined ? [`--name=${containerName}`] : []),
      ...Object.entries(env).flatMap(([key, value]) => [
        '-e',
        `${key}=${value}`,
      ]),
      dockerImage,
      // The server is started the way the image starts it
      ...(script === 'main' && args.length === 0
        ? []
        : ['node', `backend/dist/${script}.js`, ...args]),
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
}
