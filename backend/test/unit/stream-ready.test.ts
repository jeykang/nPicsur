import { HasFailed } from 'picsur-shared/dist/types/failable';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StreamReady } from '../../src/util/stream-ready.js';

// Everything that comes out of a stream, by piping it like Fastify does
async function drain(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  await pipeline(
    stream,
    new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    }),
  );
  return Buffer.concat(chunks);
}

describe('waiting for a stream to have data', () => {
  let dir: string;
  const data = Buffer.alloc(1024 * 1024, 7);

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'stream-ready-'));
    await writeFile(join(dir, 'file'), data);
    await writeFile(join(dir, 'empty'), '');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('resolves once there is data, and leaves all of it to be sent', async () => {
    const stream = createReadStream(join(dir, 'file'), {
      highWaterMark: 64 * 1024,
    });
    expect(await StreamReady(stream)).toBe(true);
    expect((await drain(stream)).equals(data)).toBe(true);
  });

  it('resolves for an empty stream', async () => {
    const stream = createReadStream(join(dir, 'empty'));
    expect(await StreamReady(stream)).toBe(true);
    expect((await drain(stream)).length).toBe(0);
  });

  it('waits for data that comes later', async () => {
    const stream = new PassThrough();
    let ready = false;
    const waiting = StreamReady(stream).then((result) => {
      ready = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(ready).toBe(false);
    stream.end('later');
    expect(await waiting).toBe(true);
    expect((await drain(stream)).toString()).toBe('later');
  });

  it('fails when reading fails before the first data', async () => {
    // Opening a directory works, reading it does not
    const stream = createReadStream(dir);
    const result = await StreamReady(stream);
    expect(HasFailed(result)).toBe(true);
    expect(stream.destroyed).toBe(true);
  });

  it('fails for a stream that failed already', async () => {
    const stream = new PassThrough();
    stream.on('error', () => undefined);
    stream.destroy(new Error('gone'));
    await new Promise((resolve) => setImmediate(resolve));
    const result = await StreamReady(stream);
    expect(HasFailed(result)).toBe(true);
  });

  it('leaves no listeners behind', async () => {
    const stream = createReadStream(join(dir, 'file'));
    await StreamReady(stream);
    expect(stream.listenerCount('readable')).toBe(0);
    expect(stream.listenerCount('error')).toBe(0);
    stream.destroy();
  });
});
