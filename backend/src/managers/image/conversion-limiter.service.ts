import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { availableParallelism } from 'os';
import {
  AsyncFailable,
  Fail,
  Failable,
  FT,
} from 'picsur-shared/dist/types/failable';
import { ParseInt } from 'picsur-shared/dist/util/parse-simple';
import { EnvPrefix } from '../../config/config.static.js';

const WINDOW_MS = 60 * 1000;
// Requests waiting for a free worker, beyond this they are refused
const MAX_QUEUE = 100;

// Keeps image conversions from overwhelming the server. Converting is by far
// the most expensive thing Picsur does, and anyone who can view an image can
// ask for any size and format of it.
@Injectable()
export class ConversionLimiterService {
  private readonly logger = new Logger(ConversionLimiterService.name);

  private readonly maxConcurrent: number;
  private readonly perClientPerMinute: number;

  private running = 0;
  private readonly queue: (() => void)[] = [];
  private readonly clients = new Map<
    string,
    { count: number; since: number }
  >();

  constructor(configService: ConfigService) {
    this.maxConcurrent = Math.max(
      1,
      ParseInt(
        configService.get(`${EnvPrefix}MAX_CONCURRENT_CONVERSIONS`),
        availableParallelism(),
      ),
    );
    this.perClientPerMinute = Math.max(
      0,
      ParseInt(configService.get(`${EnvPrefix}CONVERSION_RATE_LIMIT`), 120),
    );
    this.logger.log(
      `At most ${this.maxConcurrent} conversions at once, ` +
        (this.perClientPerMinute === 0
          ? 'no limit per client'
          : `${this.perClientPerMinute} new conversions per client per minute`),
    );
  }

  // Counts a conversion that is not cached yet against the client's limit
  public checkClient(client: string): Failable<true> {
    if (this.perClientPerMinute === 0) return true;

    const now = Date.now();
    let entry = this.clients.get(client);
    if (entry === undefined || now - entry.since >= WINDOW_MS) {
      if (this.clients.size > 10_000) this.forgetOldClients(now);
      entry = { count: 0, since: now };
      this.clients.set(client, entry);
    }

    entry.count++;
    if (entry.count > this.perClientPerMinute) {
      return Fail(FT.RateLimit, 'Too many new image conversions, slow down');
    }
    return true;
  }

  // Waits for a free worker, call the returned function when done
  public async acquire(): AsyncFailable<() => void> {
    if (this.running < this.maxConcurrent) {
      this.running++;
      return this.releaser();
    }

    if (this.queue.length >= MAX_QUEUE) {
      return Fail(FT.RateLimit, 'The server is busy, try again later');
    }

    await new Promise<void>((resolve) => this.queue.push(resolve));
    // The slot of whoever released it was handed over to us
    return this.releaser();
  }

  private releaser() {
    let released = false;
    return () => {
      if (released) return;
      released = true;

      const next = this.queue.shift();
      if (next) next();
      else this.running--;
    };
  }

  private forgetOldClients(now: number) {
    for (const [client, entry] of this.clients) {
      if (now - entry.since >= WINDOW_MS) this.clients.delete(client);
    }
  }
}
