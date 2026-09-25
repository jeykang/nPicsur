import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CollectGarbageWhenIdle,
  NoteActivity,
} from '../../src/util/idle-gc.js';

const LastResort = { type: 'major', execution: 'sync', flavor: 'last-resort' };

let stop: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  // The clock starts over for every test
  NoteActivity();
});

afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
});

describe('collecting garbage when idle', () => {
  it('waits until there were no requests for a while', () => {
    let heap = 100e6;
    const gc = vi.fn(() => {
      heap = 50e6;
    });
    stop = CollectGarbageWhenIdle(gc, () => heap);

    NoteActivity();
    vi.advanceTimersByTime(9_000);
    NoteActivity();
    vi.advanceTimersByTime(9_000);
    expect(gc).not.toHaveBeenCalled();

    vi.advanceTimersByTime(6_000);
    expect(gc).toHaveBeenCalledTimes(1);
    expect(gc).toHaveBeenCalledWith(LastResort);

    vi.advanceTimersByTime(60_000);
    expect(gc).toHaveBeenCalledTimes(1);
  });

  it('collects again once the heap grew', () => {
    let heap = 100e6;
    const gc = vi.fn(() => {
      heap = 50e6;
    });
    stop = CollectGarbageWhenIdle(gc, () => heap);
    vi.advanceTimersByTime(15_000);
    expect(gc).toHaveBeenCalledTimes(1);

    // Like health checks, which hardly take any memory
    for (let i = 0; i < 10; i++) {
      NoteActivity();
      heap += 1e6;
      vi.advanceTimersByTime(15_000);
    }
    expect(gc).toHaveBeenCalledTimes(1);

    NoteActivity();
    heap += 40e6;
    vi.advanceTimersByTime(15_000);
    expect(gc).toHaveBeenCalledTimes(2);
  });

  it('does nothing when node can not collect garbage on request', () => {
    const global = globalThis as { gc?: unknown };
    const exposed = global.gc;
    delete global.gc;
    try {
      expect(CollectGarbageWhenIdle()).toBeNull();
    } finally {
      if (exposed !== undefined) global.gc = exposed;
    }
  });
});
