import { Module } from '@nestjs/common';
import { SystemStateDbModule } from '../../collections/system-state-db/system-state-db.module.js';
import { EarlyConfigModule } from '../early/early-config.module.js';
import { InfoConfigService } from './info.config.service.js';
import { JwtConfigService } from './jwt.config.service.js';
import { UsageConfigService } from './usage.config.service.js';

// Config services that need the database, which needs the early config
// services to connect to it
@Module({
  imports: [EarlyConfigModule, SystemStateDbModule],
  providers: [JwtConfigService, InfoConfigService, UsageConfigService],
  exports: [
    EarlyConfigModule,
    JwtConfigService,
    InfoConfigService,
    UsageConfigService,
  ],
})
export class LateConfigModule {}
