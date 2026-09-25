import { BeforeApplicationShutdown, Injectable, Logger } from '@nestjs/common';
import { StorageMigrationState } from 'picsur-shared/dist/dto/api/server.dto';
import { AsyncFailable, Fail, FT } from 'picsur-shared/dist/types/failable';
import { ImageStorageMaintenanceService } from '../../collections/image-db/image-storage-maintenance.service.js';

// Moves image files to where new ones are stored in the background, started
// from the settings page. The same as `cli.js storage migrate`, which can
// still be used instead.
@Injectable()
export class StorageMigrationService implements BeforeApplicationShutdown {
  private readonly logger = new Logger('Storage');

  private state: StorageMigrationState = {
    running: false,
    stopped: false,
    target: null,
    total: 0,
    moved: 0,
    failed: 0,
    started_at: null,
    finished_at: null,
    error: null,
  };
  private job: Promise<void> | null = null;
  private stopRequested = false;

  constructor(private readonly maintenance: ImageStorageMaintenanceService) {}

  public get isRunning(): boolean {
    return this.job !== null;
  }

  public getState(): StorageMigrationState {
    return { ...this.state };
  }

  public async start(): AsyncFailable<StorageMigrationState> {
    if (this.job !== null) {
      return Fail(FT.Conflict, 'Images are already being moved');
    }

    const target = this.maintenance.target;
    let total = 0;
    try {
      const status = await this.maintenance.status();
      for (const [location, count] of Object.entries(status.files)) {
        if (location !== target) total += count;
      }
    } catch (e) {
      return Fail(FT.Database, e);
    }
    // Someone else might have started it in the meantime
    if (this.job !== null) {
      return Fail(FT.Conflict, 'Images are already being moved');
    }

    this.logger.log(`Moving ${total} image files to: ${target}`);
    this.stopRequested = false;
    this.state = {
      running: true,
      stopped: false,
      target,
      total,
      moved: 0,
      failed: 0,
      started_at: new Date(),
      finished_at: null,
      error: null,
    };
    this.job = this.run();
    return this.getState();
  }

  // Stops after the file being moved now, what is moved stays moved
  public stop(): StorageMigrationState {
    if (this.job !== null) this.stopRequested = true;
    return this.getState();
  }

  async beforeApplicationShutdown() {
    if (this.job === null) return;
    this.logger.log('Stopping moving images, to shut down');
    this.stopRequested = true;
    await this.job;
  }

  private async run() {
    try {
      const result = await this.maintenance.migrate({
        onProgress: (progress) => {
          this.state.moved = progress.moved;
          this.state.failed = progress.failed;
        },
        shouldStop: () => this.stopRequested,
      });
      this.state.moved = result.moved;
      this.state.failed = result.failed;
      this.state.stopped = result.stopped;
      if (result.failed > 0) {
        this.state.error = `${result.failed} files could not be moved, the server log says why. Moving them again tries them again.`;
      }
      this.logger.log(
        `${result.stopped ? 'Stopped' : 'Done'} moving images, moved ${result.moved} files` +
          (result.failed > 0 ? `, ${result.failed} failed` : ''),
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error(`Moving images failed: ${message}`);
      this.state.error = message;
    } finally {
      this.state.running = false;
      this.state.finished_at = new Date();
      this.job = null;
    }
  }
}
