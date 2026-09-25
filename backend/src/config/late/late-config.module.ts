import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { HasFailed } from 'picsur-shared/dist/types/failable';
import { PreferenceDbModule } from '../../collections/preference-db/preference-db.module.js';
import { SysPreferenceDbService } from '../../collections/preference-db/sys-preference-db.service.js';
import { EarlyConfigModule } from '../early/early-config.module.js';
import { EarlyJwtConfigService } from '../early/early-jwt.config.service.js';
import { InfoConfigService } from './info.config.service.js';
import { JwtConfigService } from './jwt.config.service.js';
import { UsageConfigService } from './usage.config.service.js';

// This module contains all configservices that depend on the syspref module
// The syspref module can only be used when connected to the database
// Since the syspref module requires the database config, we need this seperate
// Otherwise we will create a circular depedency

@Module({
  imports: [EarlyConfigModule, PreferenceDbModule],
  providers: [JwtConfigService, InfoConfigService, UsageConfigService],
  exports: [
    EarlyConfigModule,
    JwtConfigService,
    InfoConfigService,
    UsageConfigService,
  ],
})
export class LateConfigModule implements OnModuleInit {
  private readonly logger = new Logger(LateConfigModule.name);

  constructor(
    private readonly envJwtConfigService: EarlyJwtConfigService,
    private readonly prefService: SysPreferenceDbService,
  ) {}

  async onModuleInit() {
    await this.ensureJwtDefaultsLoaded();
  }

  async ensureJwtDefaultsLoaded() {
    const envSecret = this.envJwtConfigService.getJwtSecret();
    const envExpiresIn = this.envJwtConfigService.getJwtExpiresIn();

    if (envSecret === undefined) {
      await this.prefService.getPreference('jwt_secret');
    } else {
      if (envSecret.length < 32) {
        this.logger.warn(
          'PICSUR_JWT_SECRET is shorter than 32 characters, which makes it ' +
            'easier to guess, and whoever knows it can log in as anyone. Use ' +
            'a long random value, or leave it out to have one generated.',
        );
      }
      const saved = await this.prefService.setPreference(
        'jwt_secret',
        envSecret,
      );
      if (HasFailed(saved)) saved.print(this.logger);
    }

    if (envExpiresIn !== undefined) {
      const saved = await this.prefService.setPreference(
        'jwt_expires_in',
        envExpiresIn,
      );
      if (HasFailed(saved)) {
        saved.print(this.logger, { prefix: 'PICSUR_JWT_EXPIRY is invalid:' });
      }
    }
  }
}
