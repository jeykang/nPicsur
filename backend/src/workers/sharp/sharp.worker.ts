import { readFileSync } from 'fs';
import { FileType } from 'picsur-shared/dist/dto/mimes.dto';
import { setrlimit } from 'posix.js';
import sharp, { Sharp } from 'sharp';
import {
  SharpWorkerFinishOptions,
  SharpWorkerInitMessage,
  SharpWorkerOperationMessage,
  SharpWorkerRecieveMessage,
  SharpWorkerSendMessage,
} from './sharp.message.js';
import { UniversalSharpIn, UniversalSharpOut } from './universal-sharp.js';

export class SharpWorker {
  private startTime = 0;
  private sharpi: Sharp | null = null;

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

    this.restrictLoaders();
    this.limitMemory(memoryLimit);

    process.on('message', this.messageHandler.bind(this));

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
    // Every worker handles a single image, caching only costs memory
    sharp.cache(false);
  }

  // Limit how much memory the image processing may use on top of what the
  // worker already has reserved. How much Node itself reserves differs a lot
  // between versions (Node 24 starts out with about 10 times as much as Node
  // 22), so the limit can not simply be an absolute number.
  private limitMemory(limitMB: number) {
    let baseline: number;
    try {
      const status = readFileSync('/proc/self/status', 'utf8');
      const match = /^VmData:\s+(\d+) kB$/m.exec(status);
      if (!match) throw new Error('VmData not found');
      baseline = Number(match[1]) * 1024;
    } catch (e) {
      console.warn('Failed to measure memory usage, not limiting memory');
      return;
    }

    const limit = baseline + 1000 * 1000 * limitMB;
    try {
      setrlimit('data', { soft: limit, hard: limit });
    } catch (e) {
      console.warn('Failed to set memory limit');
    }
  }

  private messageHandler(message: SharpWorkerSendMessage): void {
    if (message.type === 'init') {
      this.init(message);
    } else if (message.type === 'operation') {
      this.operation(message);
    } else if (message.type === 'finish') {
      this.finish(message.filetype, message.options);
    } else {
      return this.purge('Unknown message type');
    }
  }

  private init(message: SharpWorkerInitMessage): void {
    if (this.sharpi !== null) {
      return this.purge('Already initialized');
    }

    this.startTime = Date.now();
    this.sharpi = UniversalSharpIn(
      message.image,
      message.filetype,
      message.options,
    );
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
    this.sharpi = null;

    try {
      const result = await UniversalSharpOut(sharpi, filetype, options);
      const processingTime = Date.now() - this.startTime;

      this.sendMessage({
        type: 'result',
        processingTime,
        result,
      });
    } catch (e) {
      return this.purge(e);
    }
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
