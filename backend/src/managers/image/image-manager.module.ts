import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ServerSetting } from 'picsur-shared/dist/dto/server-settings.dto';
import { HasFailed } from 'picsur-shared/dist/types/failable';
import { ImageDBModule } from '../../collections/image-db/image-db.module.js';
import { ImageDBService } from '../../collections/image-db/image-db.service.js';
import { ImageFileDBService } from '../../collections/image-db/image-file-db.service.js';
import { PreferenceDbModule } from '../../collections/preference-db/preference-db.module.js';
import { EarlyConfigModule } from '../../config/early/early-config.module.js';
import { GetServerSettingDuration } from '../../config/server-settings.js';
import { SharpWorkerPool } from '../../workers/sharp.pool.js';
import { ConversionLimiterService } from './conversion-limiter.service.js';
import { ImageConverterService } from './image-converter.service.js';
import { ImageProcessorService } from './image-processor.service.js';
import { ImageManagerService } from './image.service.js';

@Module({
  imports: [ImageDBModule, PreferenceDbModule, EarlyConfigModule],
  providers: [
    ImageManagerService,
    ImageProcessorService,
    ImageConverterService,
    ConversionLimiterService,
    SharpWorkerPool,
  ],
  exports: [ImageManagerService, ImageConverterService],
})
export class ImageManagerModule implements OnModuleInit {
  private readonly logger = new Logger(ImageManagerModule.name);

  constructor(
    private readonly imageFileDB: ImageFileDBService,
    private readonly imageDB: ImageDBService,
  ) {}

  async onModuleInit() {
    await this.imageManagerCron();
  }

  @Interval(1000 * 60)
  private async imageManagerCron() {
    await this.cleanupDerivatives();
    await this.cleanupExpired();
  }

  // Converted versions that were not asked for in a while are made again when
  // needed, 0 keeps them
  private async cleanupDerivatives() {
    const after = GetServerSettingDuration(
      ServerSetting.RemoveDerivativesAfter,
    );
    if (after === 0) return;

    const result = await this.imageFileDB.cleanupDerivatives(after / 1000);
    if (HasFailed(result)) {
      result.print(this.logger);
      return;
    }

    if (result > 0) this.logger.log(`Removed ${result} converted versions`);
  }

  private async cleanupExpired() {
    const cleanedUp = await this.imageDB.cleanupExpired();

    if (HasFailed(cleanedUp)) {
      cleanedUp.print(this.logger);
      return;
    }

    if (cleanedUp > 0)
      this.logger.log(`Cleaned up ${cleanedUp} expired images`);
  }
}
