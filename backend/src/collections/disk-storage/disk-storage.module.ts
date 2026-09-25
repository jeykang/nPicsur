import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { HasFailed } from 'picsur-shared/dist/types/failable';
import { EarlyConfigModule } from '../../config/early/early-config.module.js';
import { DiskStorageService } from './disk-storage.service.js';

@Module({
  imports: [EarlyConfigModule],
  providers: [DiskStorageService],
  exports: [DiskStorageService],
})
export class DiskStorageModule implements OnModuleInit {
  private readonly logger = new Logger(DiskStorageModule.name);

  constructor(private readonly storage: DiskStorageService) {}

  async onModuleInit() {
    if (!this.storage.isConfigured) return;

    const result = await this.storage.ensureDirectory();
    if (HasFailed(result)) {
      // Nothing can be uploaded like this, better to fail loudly
      if (this.storage.isWriteTarget) throw new Error(result.getReason());
      // Only needed for reading images that were stored there before
      this.logger.warn(result.getReason());
      return;
    }
    if (result.warning !== null && this.storage.isWriteTarget) {
      this.logger.warn(result.warning);
    }
  }
}
