import { inject } from 'vitest';
import { spawnBackend } from './backend.js';

// Runs the command line tool against the test database, with the server's
// environment and the given changes to it
export function cli(args: string[], envOverrides: Record<string, string> = {}) {
  return new Promise<{ code: number; output: string }>((done) => {
    const child = spawnBackend(
      'cli',
      args,
      { ...inject('serverEnv'), ...envOverrides },
      inject('dockerImage'),
    );
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('close', (code) => done({ code: code ?? -1, output }));
  });
}
