import { Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { FileType } from 'picsur-shared/dist/dto/mimes.dto';
import { Failable, HasFailed } from 'picsur-shared/dist/types/failable';
import { ParseFileType } from 'picsur-shared/dist/util/parse-mime';
import sharp from 'sharp';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  SharpWorkerPool,
  type SharpWorkerProcess,
} from '../../dist/workers/sharp.pool.js';
import { SharpWrapper } from '../../dist/workers/sharp.wrapper.js';
import type { SharpResult } from '../../dist/workers/sharp/universal-sharp.js';
import { makePng } from './helpers/images.js';

// The conversion workers of the compiled backend, without a server around them

// Remembers which workers conversions ran in
class TestPool extends SharpWorkerPool {
  public readonly used: SharpWorkerProcess[] = [];

  public override async acquire(memoryLimit: number, timeout: number) {
    const worker = await super.acquire(memoryLimit, timeout);
    if (!HasFailed(worker)) this.used.push(worker);
    return worker;
  }
}

function fileType(identifier: string): FileType {
  const parsed = ParseFileType(identifier);
  if (HasFailed(parsed)) throw parsed;
  return parsed;
}

const PNG = fileType('image:png');
const WEBP = fileType('image:webp');
const AVIF = fileType('image:avif');

async function convert(
  pool: SharpWorkerPool,
  image: Buffer,
  options: {
    memoryLimit?: number;
    timeout?: number;
    to?: FileType;
    flip?: boolean;
  } = {},
): Promise<Failable<SharpResult>> {
  const wrapper = new SharpWrapper(
    pool,
    options.timeout ?? 15_000,
    options.memoryLimit ?? 512,
  );
  const started = await wrapper.start(image, PNG, {});
  if (HasFailed(started)) return started;
  if (options.flip) wrapper.operation('flip');
  else wrapper.operation('resize', { width: 32 });
  return wrapper.finish(options.to ?? WEBP, {});
}

function exited(worker: SharpWorkerProcess): Promise<void> {
  const child = worker.process;
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => child.once('exit', () => resolve()));
}

function running(worker: SharpWorkerProcess): boolean {
  return worker.process.exitCode === null && worker.process.signalCode === null;
}

let pools: TestPool[] = [];
function newPool() {
  const pool = new TestPool();
  pools.push(pool);
  return pool;
}

beforeAll(() => {
  Logger.overrideLogger(['error']);
});

afterEach(() => {
  for (const pool of pools) pool.onApplicationShutdown();
  pools = [];
});

describe('conversion workers', () => {
  it('convert one image after another', async () => {
    const pool = newPool();
    const image = await makePng();
    for (let i = 0; i < 3; i++) {
      const result = await convert(pool, image);
      if (HasFailed(result)) throw result;
      expect(result.info.width).toBe(32);
    }
    expect(pool.used).toHaveLength(3);
    expect(new Set(pool.used)).toEqual(new Set([pool.used[0]]));
  });

  it('are replaced when a conversion fails', async () => {
    const pool = newPool();
    const broken = await convert(pool, Buffer.from('not an image at all'));
    expect(HasFailed(broken)).toBe(true);
    await exited(pool.used[0]);

    const result = await convert(pool, await makePng());
    expect(HasFailed(result)).toBe(false);
    expect(pool.used[1]).not.toBe(pool.used[0]);
  });

  it('are stopped when a conversion takes too long', async () => {
    const pool = newPool();
    // Started beforehand, so the short time limit is all for the conversion
    expect(HasFailed(await convert(pool, await makePng()))).toBe(false);

    const noise = await sharp({
      create: {
        width: 1500,
        height: 1500,
        channels: 3,
        background: '#000',
        noise: { type: 'gaussian', mean: 128, sigma: 60 },
      },
    })
      .png()
      .toBuffer();
    const slow = await convert(pool, noise, {
      timeout: 100,
      to: AVIF,
      flip: true,
    });
    expect(HasFailed(slow) && slow.getDebugMessage()).toContain('took longer');
    expect(pool.used[1]).toBe(pool.used[0]);
    await exited(pool.used[1]);

    expect(HasFailed(await convert(pool, await makePng()))).toBe(false);
  });

  it.runIf(process.platform === 'linux')(
    'can not use more memory than allowed',
    async () => {
      const pool = newPool();
      // Flipping needs the whole image in memory, 48 MB here
      const big = await sharp({
        create: { width: 4000, height: 4000, channels: 3, background: '#f80' },
      })
        .png()
        .toBuffer();

      const limited = await convert(pool, big, {
        memoryLimit: 16,
        to: PNG,
        flip: true,
      });
      expect(HasFailed(limited)).toBe(true);
      await exited(pool.used[0]);

      const allowed = await convert(pool, big, {
        memoryLimit: 256,
        to: PNG,
        flip: true,
      });
      if (HasFailed(allowed)) throw allowed;
      expect(allowed.info.width).toBe(4000);
    },
  );

  it.runIf(process.platform === 'linux')(
    'can be allowed more than 2 GB of memory',
    async () => {
      const pool = newPool();
      const worker = await pool.acquire(4096, 15_000);
      if (HasFailed(worker)) throw worker;

      const limits = readFileSync(`/proc/${worker.process.pid}/limits`, 'utf8');
      const soft = Number(/^Max data size\s+(\d+)/m.exec(limits)?.[1]);
      // On top of what the worker already uses
      expect(soft).toBeGreaterThan(4096e6);
      expect(soft).toBeLessThan(2 * 4096e6);
      pool.discard(worker);
    },
  );

  it('are replaced when they hold on to a lot of memory', async () => {
    const pool = newPool();
    const grown = await pool.acquire(512, 15_000);
    if (HasFailed(grown)) throw grown;
    pool.release(grown, 400e6);
    await exited(grown);

    const kept = await pool.acquire(512, 15_000);
    if (HasFailed(kept)) throw kept;
    expect(kept).not.toBe(grown);
    pool.release(kept, 20e6);
    expect(running(kept)).toBe(true);
    expect(await pool.acquire(512, 15_000)).toBe(kept);
    pool.discard(kept);
  });

  it('only take conversions with the same memory limit', async () => {
    const pool = newPool();
    const worker = await pool.acquire(512, 15_000);
    if (HasFailed(worker)) throw worker;
    pool.release(worker, 0);

    const other = await pool.acquire(256, 15_000);
    if (HasFailed(other)) throw other;
    expect(other).not.toBe(worker);
    pool.discard(other);
  });

  it('stop when Picsur stops', async () => {
    const pool = newPool();
    expect(HasFailed(await convert(pool, await makePng()))).toBe(false);
    const idle = pool.used[0];
    expect(running(idle)).toBe(true);

    pool.onApplicationShutdown();
    await exited(idle);
    expect(HasFailed(await pool.acquire(512, 15_000))).toBe(true);

    // And on their own when Picsur is gone without stopping them
    const orphan = await newPool().acquire(512, 15_000);
    if (HasFailed(orphan)) throw orphan;
    orphan.process.disconnect();
    await exited(orphan);
    expect(orphan.process.exitCode).toBe(0);
  });
});
