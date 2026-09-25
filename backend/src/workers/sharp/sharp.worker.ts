import { readFileSync } from 'fs';
import { FileType } from 'picsur-shared/dist/dto/mimes.dto';
import { getrlimit, setrlimit } from 'posix.js';
import sharp, { Sharp } from 'sharp';
import {
  SharpWorkerFinishOptions,
  SharpWorkerInitMessage,
  SharpWorkerOperationMessage,
  SharpWorkerRecieveMessage,
  SharpWorkerSendMessage,
} from './sharp.message.js';
import {
  AnimationTiming,
  UniversalSharpIn,
  UniversalSharpOut,
} from './universal-sharp.js';

// Only there when the worker is started with --expose-gc
const collectGarbage = (globalThis as { gc?: () => void }).gc;

// How much memory the process has reserved in bytes, which is what the memory
// limit applies to. Only Linux can tell.
function reservedMemory(): number | null {
  try {
    const status = readFileSync('/proc/self/status', 'utf8');
    const match = /^VmData:\s+(\d+) kB$/m.exec(status);
    return match ? Number(match[1]) * 1024 : null;
  } catch {
    return null;
  }
}

// Converts one image after another, sent by the SharpWorkerPool
export class SharpWorker {
  private startTime = 0;
  private sharpi: Sharp | null = null;
  private timing: AnimationTiming | null = null;
  // Messages are handled one after another, reading some formats takes a
  // while
  private queue: Promise<void> = Promise.resolve();

  // In bytes
  private memoryLimit = 0;
  private startMemory: number | null = null;

  constructor() {
    this.setup();
  }

  private setup() {
    if (process.send === undefined) {
      return this.purge('This is not a worker process');
    }

    const memoryLimit = parseInt(process.env['MEMORY_LIMIT_MB'] ?? '');

    if (isNaN(memoryLimit) || memoryLimit <= 0) {
      return this.purge('MEMORY_LIMIT_MB environment variable is not set');
    }
    this.memoryLimit = 1000 * 1000 * memoryLimit;

    this.restrictLoaders();
    this.startMemory = reservedMemory();
    if (this.startMemory === null) {
      console.warn('Failed to measure memory usage, not limiting memory');
    }
    this.limitMemory();

    process.on('message', this.messageHandler.bind(this));
    // Nothing is left to do once Picsur is gone
    process.on('disconnect', () => process.exit(0));

    this.sendMessage({
      type: 'ready',
    });
  }

  // Only allow the libvips loaders for formats Picsur accepts. libvips picks a
  // loader by looking at the data, so without this a crafted upload could end
  // up in a loader nobody meant to expose (svg, pdf, imagemagick, ...).
  private restrictLoaders() {
    sharp.block({ operation: ['VipsForeignLoad'] });
    sharp.unblock({
      operation: [
        'VipsForeignLoadJpegBuffer',
        'VipsForeignLoadPngBuffer',
        'VipsForeignLoadWebpBuffer',
        'VipsForeignLoadTiffBuffer',
        'VipsForeignLoadNsgifBuffer',
        'VipsForeignLoadHeifBuffer',
        'VipsForeignLoadJxlBuffer',
        'VipsForeignLoadJp2kBuffer',
      ],
    });
    // Images are not converted twice, caching only costs memory
    sharp.cache(false);
  }

  // Every conversion may use this much memory on top of what the worker holds
  // when it starts on it. How much Node itself reserves differs a lot between
  // versions (Node 24 starts out with about 10 times as much as Node 22), so
  // the limit can not simply be an absolute number.
  private limitMemory() {
    if (this.startMemory === null) return;
    const current = reservedMemory();
    if (current === null) return;

    try {
      // The pool replaces workers that hold on to much more memory than they
      // started with, long before they get to this
      let hard = this.startMemory + 2 * this.memoryLimit;
      const inherited = getrlimit('data').hard;
      if (inherited !== null && inherited !== undefined) {
        hard = Math.min(hard, inherited);
      }
      setrlimit('data', {
        soft: Math.min(current + this.memoryLimit, hard),
        hard,
      });
    } catch (e) {
      console.warn('Failed to set memory limit');
    }
  }

  private messageHandler(message: SharpWorkerSendMessage): void {
    this.queue = this.queue
      .then(() => this.handle(message))
      .catch((e) => this.purge(e));
  }

  private async handle(message: SharpWorkerSendMessage): Promise<void> {
    if (message.type === 'init') {
      await this.init(message);
    } else if (message.type === 'operation') {
      this.operation(message);
    } else if (message.type === 'finish') {
      await this.finish(message.filetype, message.options);
    } else {
      return this.purge('Unknown message type');
    }
  }

  private async init(message: SharpWorkerInitMessage): Promise<void> {
    if (this.sharpi !== null) {
      return this.purge('Already initialized');
    }

    this.startTime = Date.now();
    this.limitMemory();
    const input = await UniversalSharpIn(
      message.image,
      message.filetype,
      message.options,
    );
    this.sharpi = input.image;
    this.timing = input.timing;
  }

  private operation(message: SharpWorkerOperationMessage): void {
    if (this.sharpi === null) {
      return this.purge('Not initialized');
    }

    const operation = message.operation;
    message.operation.parameters;

    this.sharpi = (this.sharpi[operation.name] as any)(...operation.parameters);
  }

  private async finish(
    filetype: FileType,
    options: SharpWorkerFinishOptions,
  ): Promise<void> {
    if (this.sharpi === null) {
      return this.purge('Not initialized');
    }

    const sharpi = this.sharpi;
    const timing = this.timing;
    this.sharpi = null;
    this.timing = null;

    try {
      const result = await UniversalSharpOut(sharpi, filetype, options, timing);
      const processingTime = Date.now() - this.startTime;
      const memory = reservedMemory();

      this.sendMessage({
        type: 'result',
        processingTime,
        result,
        memoryGrowth:
          memory === null || this.startMemory === null
            ? undefined
            : memory - this.startMemory,
      });
    } catch (e) {
      return this.purge(e);
    }

    // Frees the images of this conversion before the next one, the result is
    // on its way already
    setImmediate(() => collectGarbage?.());
  }

  private sendMessage(message: SharpWorkerRecieveMessage): void {
    if (process.send === undefined) {
      return this.purge('This is not a worker process');
    }

    process.send(message);
  }

  private purge(reason: any): void {
    if (typeof reason === 'string') {
      console.error(new Error(reason));
    } else {
      console.error(reason);
    }
    process.exit(1);
  }
}

new SharpWorker();
