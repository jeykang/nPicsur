// V8 keeps the memory it took while Picsur was busy, even once nothing uses it
// anymore. It only gives memory back after a garbage collection that is meant
// to, which it does not run by itself while Picsur has nothing to do. So when
// Picsur is idle after the heap grew, it runs one. That takes up to about
// 100 ms, which nobody is waiting for then.
//
// Only works when node is started with --expose-gc, like the Docker image does.

import { Logger } from '@nestjs/common';
import { getHeapStatistics } from 'node:v8';

// Without requests for this long, requests that keep coming in like health
// checks still leave room for it
const IdleAfter = 10 * 1000;
// How much the heap has to grow before collecting is worth it, in bytes
const MinGrowth = 32 * 1000 * 1000;

export type CollectGarbage = (options: {
  type: 'major';
  execution: 'sync';
  flavor: 'last-resort';
}) => void;

let lastActivity = 0;

// For every request, so collecting waits until Picsur is idle
export function NoteActivity() {
  lastActivity = Date.now();
}

// Returns a function to stop it, or null when node can not collect garbage on
// request
export function CollectGarbageWhenIdle(
  gc = (globalThis as { gc?: CollectGarbage }).gc,
  heapSize = () => getHeapStatistics().total_heap_size,
): (() => void) | null {
  if (gc === undefined) return null;
  const logger = new Logger('Memory');

  // Nothing collected yet, starting takes memory like being busy does
  let heapAfterCollection = 0;
  const timer = setInterval(() => {
    if (Date.now() - lastActivity < IdleAfter) return;
    const before = heapSize();
    if (before < heapAfterCollection + MinGrowth) return;

    gc({ type: 'major', execution: 'sync', flavor: 'last-resort' });
    heapAfterCollection = heapSize();
    logger.verbose(
      `Idle, the heap went from ${Math.round(before / 1e6)} MB to ${Math.round(heapAfterCollection / 1e6)} MB`,
    );
  }, IdleAfter / 2);
  timer.unref();

  return () => clearInterval(timer);
}
