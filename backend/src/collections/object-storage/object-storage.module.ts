import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { HasFailed } from 'picsur-shared/dist/types/failable';
import { EarlyConfigModule } from '../../config/early/early-config.module.js';
import { ObjectStorageService } from './object-storage.service.js';

@Module({
  imports: [EarlyConfigModule],
  providers: [ObjectStorageService],
  exports: [ObjectStorageService],
})
export class ObjectStorageModule implements OnModuleInit {
  private readonly logger = new Logger(ObjectStorageModule.name);

  constructor(private readonly storage: ObjectStorageService) {}

  async onModuleInit() {
    if (!this.storage.isConfigured) return;

    const result = await this.storage.ensureBucket();
    if (!HasFailed(result)) return;

    const message = `${result.getReason()}: ${result.getDebugMessage()}`;
    if (this.storage.isWriteTarget) {
      // Nothing can be uploaded like this, better to fail loudly
      throw new Error(message);
    }
    // Only needed for reading images that were stored there before
    this.logger.warn(message);
  }
}
