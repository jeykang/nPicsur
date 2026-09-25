import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ChildProcess, fork } from 'child_process';
import { Socket } from 'net';
import { dirname, join as pathJoin } from 'path';
import {
  AsyncFailable,
  Fail,
  Failable,
  FT,
  HasFailed,
} from 'picsur-shared/dist/types/failable';
import { SharpWorkerRecieveMessage } from './sharp/sharp.message.js';

const moduleURL = new URL(import.meta.url);
const __dirname = dirname(moduleURL.pathname);
const WorkerPath = pathJoin(__dirname, './sharp', 'sharp.worker.js');

// Starting a worker takes many times longer than converting a small image, so
// workers are used for more than one conversion. Not too many though, and not
// when they hold on to a lot of memory afterwards, which large images can
// cause.
const MaxConversions = 50;
// As a part of the memory limit
const MaxMemoryGrowth = 0.25;
// Workers are stopped when nothing needs them for this long
const IdleTimeout = 30 * 1000;

export interface SharpWorkerProcess {
  readonly id: number;
  readonly process: ChildProcess;
  // In megabytes
  readonly memoryLimit: number;
  conversions: number;
  idleTimer: NodeJS.Timeout | null;
}

// Images are converted in separate processes, so a crafted or huge image can
// not take the server down with it. Each one converts one image at a time,
// with limited memory, and is stopped when a conversion fails or takes too
// long.
@Injectable()
export class SharpWorkerPool implements OnApplicationShutdown {
  private readonly logger = new Logger(SharpWorkerPool.name);

  private readonly idle: SharpWorkerProcess[] = [];
  private nextId = 1;
  private closed = false;

  // A worker for one conversion, give it back with release or discard
  public async acquire(
    memoryLimit: number,
    timeout: number,
  ): AsyncFailable<SharpWorkerProcess> {
    if (this.closed) return Fail(FT.Internal, 'Picsur is stopping');

    // The one used last, so the others can time out when there is not enough
    // to do for all of them
    for (let i = this.idle.length - 1; i >= 0; i--) {
      const worker = this.idle[i];
      if (worker.memoryLimit !== memoryLimit) continue;

      this.forget(worker);
      if (!IsRunning(worker)) {
        this.stop(worker);
        continue;
      }
      KeepPicsurRunning(worker, true);
      return worker;
    }

    return this.start(memoryLimit, timeout);
  }

  // Takes back a worker that finished its conversion
  public release(worker: SharpWorkerProcess, memoryGrowth?: number) {
    worker.conversions++;
    const maxGrowth = worker.memoryLimit * 1000 * 1000 * MaxMemoryGrowth;
    if (
      this.closed ||
      !IsRunning(worker) ||
      worker.conversions >= MaxConversions ||
      (memoryGrowth !== undefined && memoryGrowth > maxGrowth)
    ) {
      this.stop(worker);
      return;
    }

    KeepPicsurRunning(worker, false);
    worker.idleTimer = setTimeout(() => this.stop(worker), IdleTimeout);
    worker.idleTimer.unref();
    this.idle.push(worker);
  }

  // Stops a worker that failed, or took too long
  public discard(worker: SharpWorkerProcess) {
    this.stop(worker);
  }

  public onApplicationShutdown() {
    this.closed = true;
    for (const worker of [...this.idle]) this.stop(worker);
  }

  private async start(
    memoryLimit: number,
    timeout: number,
  ): AsyncFailable<SharpWorkerProcess> {
    const id = this.nextId++;
    const child = fork(WorkerPath, {
      serialization: 'advanced',
      // To free the memory of a conversion before the next one
      execArgv: ['--expose-gc'],
      env: {
        // The worker handles untrusted data, so it does not get the
        // environment (and with it the secrets) of the server, apart from
        // settings meant for libvips and sharp
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            ([key]) => key.startsWith('VIPS_') || key.startsWith('SHARP_'),
          ),
        ),
        MEMORY_LIMIT_MB: memoryLimit.toString(),
        NODE_OPTIONS: '--no-warnings',
      },
      stdio: 'overlapped',
    });
    const worker: SharpWorkerProcess = {
      id,
      process: child,
      memoryLimit,
      conversions: 0,
      idleTimer: null,
    };

    child.stdout?.on('data', (data) => {
      this.logger.verbose(`Worker ${id} log: ${data}`);
    });
    child.stderr?.on('data', (data) => {
      this.logger.warn(`Worker ${id} error: ${data}`);
    });
    child.on('error', (error) => {
      this.logger.error(`Worker ${id} error: ${error}`);
    });
    child.once('exit', (code, signal) => {
      this.logger.verbose(
        `Worker ${id} exited with code ${code} and signal ${signal}`,
      );
      this.forget(worker);
    });

    const ready = await WaitForReady(child, timeout);
    if (HasFailed(ready)) {
      this.stop(worker);
      return ready;
    }

    this.logger.verbose(
      `Worker ${id} started with a ${memoryLimit}MB memory limit`,
    );
    return worker;
  }

  private stop(worker: SharpWorkerProcess) {
    this.forget(worker);
    worker.process.kill('SIGKILL');
  }

  private forget(worker: SharpWorkerProcess) {
    if (worker.idleTimer !== null) {
      clearTimeout(worker.idleTimer);
      worker.idleTimer = null;
    }
    const index = this.idle.indexOf(worker);
    if (index !== -1) this.idle.splice(index, 1);
  }
}

function IsRunning(worker: SharpWorkerProcess): boolean {
  const child = worker.process;
  return (
    child.exitCode === null && child.signalCode === null && child.connected
  );
}

// Workers waiting for a conversion do not keep Picsur from exiting
function KeepPicsurRunning(worker: SharpWorkerProcess, keep: boolean) {
  const child = worker.process;
  const handles = [child, child.channel, child.stdout, child.stderr] as (
    Pick<Socket, 'ref' | 'unref'> | null | undefined
  )[];
  for (const handle of handles) {
    if (keep) handle?.ref();
    else handle?.unref();
  }
}

function WaitForReady(
  child: ChildProcess,
  timeout: number,
): AsyncFailable<true> {
  return new Promise((resolve) => {
    const done = (result: Failable<true>) => {
      clearTimeout(timer);
      child.off('message', onMessage);
      child.off('exit', onExit);
      child.off('error', onError);
      resolve(result);
    };
    const onMessage = (message: SharpWorkerRecieveMessage) => {
      done(
        message.type === 'ready'
          ? true
          : Fail(
              FT.Internal,
              `Unexpected message from worker: ${message.type}`,
            ),
      );
    };
    const onExit = () =>
      done(Fail(FT.Internal, 'Worker stopped while starting'));
    const onError = (error: Error) => done(Fail(FT.Internal, error));
    const timer = setTimeout(
      () => done(Fail(FT.Internal, 'Worker took too long to start')),
      timeout,
    );

    child.on('message', onMessage);
    child.on('exit', onExit);
    child.on('error', onError);
  });
}
