import { Logger } from '@nestjs/common';
import { FileType } from 'picsur-shared/dist/dto/mimes.dto';
import {
  AsyncFailable,
  Fail,
  Failable,
  FT,
  HasFailed,
} from 'picsur-shared/dist/types/failable';
import { Sharp, SharpOptions } from 'sharp';
import { SharpWorkerPool, SharpWorkerProcess } from './sharp.pool.js';
import {
  SharpWorkerFinishOptions,
  SharpWorkerOperation,
  SharpWorkerRecieveMessage,
  SharpWorkerResultMessage,
  SharpWorkerSendMessage,
  SupportedSharpWorkerFunctions,
} from './sharp/sharp.message.js';
import { SharpResult } from './sharp/universal-sharp.js';

// One conversion, in a worker from the pool
export class SharpWrapper {
  private readonly logger: Logger = new Logger(SharpWrapper.name);

  private worker: SharpWorkerProcess | null = null;
  private result: Promise<SharpWorkerResultMessage> | null = null;

  constructor(
    private readonly pool: SharpWorkerPool,
    private readonly instance_timeout: number,
    private readonly memory_limit: number,
  ) {}

  public async start(
    image: Buffer,
    filetype: FileType,
    sharpOptions?: SharpOptions,
  ): AsyncFailable<true> {
    const worker = await this.pool.acquire(
      this.memory_limit,
      this.instance_timeout,
    );
    if (HasFailed(worker)) return worker;
    this.worker = worker;
    this.result = this.waitForResult(worker);

    const hasSent = this.sendToWorker({
      type: 'init',
      image,
      filetype,
      options: sharpOptions,
    });
    if (HasFailed(hasSent)) {
      this.purge();
      return hasSent;
    }

    return true;
  }

  public operation<Operation extends SupportedSharpWorkerFunctions>(
    operation: Operation,
    ...parameters: Parameters<Sharp[Operation]>
  ): Failable<true> {
    const hasSent = this.sendToWorker({
      type: 'operation',
      operation: {
        name: operation,
        parameters,
      } as SharpWorkerOperation,
    });
    if (HasFailed(hasSent)) {
      this.purge();
      return hasSent;
    }

    return true;
  }

  public async finish(
    targetFiletype: FileType,
    options?: SharpWorkerFinishOptions,
  ): AsyncFailable<SharpResult> {
    const worker = this.worker;
    const result = this.result;
    if (worker === null || result === null) {
      return Fail(FT.Internal, 'Worker is not initialized');
    }

    const hasSent = this.sendToWorker({
      type: 'finish',
      filetype: targetFiletype,
      options: options ?? {},
    });
    this.worker = null;
    this.result = null;
    if (HasFailed(hasSent)) {
      this.pool.discard(worker);
      return hasSent;
    }

    try {
      const message = await result;
      this.logger.verbose(
        `Worker ${worker.id} finished in ${message.processingTime}ms`,
      );
      this.pool.release(worker, message.memoryGrowth);
      return message.result;
    } catch (error) {
      return Fail(FT.Internal, error);
    }
  }

  // The whole conversion has to be done within the time limit, otherwise the
  // worker is stopped. That also stops it when the conversion is given up on
  // without finishing it.
  private waitForResult(
    worker: SharpWorkerProcess,
  ): Promise<SharpWorkerResultMessage> {
    const child = worker.process;
    const result = new Promise<SharpWorkerResultMessage>((resolve, reject) => {
      let settled = false;
      const done = (
        error: Error | null,
        message?: SharpWorkerResultMessage,
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.off('message', onMessage);
        child.off('exit', onExit);

        if (error !== null || message === undefined) {
          this.pool.discard(worker);
          reject(error);
        } else {
          resolve(message);
        }
      };

      const onMessage = (message: SharpWorkerRecieveMessage) => {
        if (message.type === 'result') done(null, message);
        else done(new Error(`Unexpected message from worker: ${message.type}`));
      };
      const onExit = (code: number | null, signal: string | null) => {
        done(new Error(`Worker exited with code ${code} and signal ${signal}`));
      };
      const timer = setTimeout(() => {
        done(
          new Error(
            `Conversion took longer than ${this.instance_timeout}ms, stopped it`,
          ),
        );
      }, this.instance_timeout);

      child.on('message', onMessage);
      child.on('exit', onExit);
    });
    // Nothing waits for it when the conversion is given up on
    result.catch(() => undefined);
    return result;
  }

  private sendToWorker(message: SharpWorkerSendMessage): Failable<true> {
    if (!this.worker) {
      return Fail(FT.Internal, 'Worker is not initialized');
    }

    try {
      this.worker.process.send(message);
    } catch (error) {
      return Fail(FT.Internal, error);
    }
    return true;
  }

  private purge() {
    if (this.worker) this.pool.discard(this.worker);
    this.worker = null;
    this.result = null;
  }
}
