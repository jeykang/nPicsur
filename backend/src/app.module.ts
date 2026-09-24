import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import semver from 'semver';
import { DatabaseModule } from './database/database.module.js';
import { PicsurLayersModule } from './layers/PicsurLayers.module.js';
import { PicsurLoggerModule } from './logger/logger.module.js';
import { AuthManagerModule } from './managers/auth/auth.module.js';
import { DemoManagerModule } from './managers/demo/demo.module.js';
import { PicsurRoutesModule } from './routes/routes.module.js';

const supportedNodeVersions = ['>=22.12.0'];

@Module({
  imports: [
    PicsurLoggerModule,
    ScheduleModule.forRoot(),
    DatabaseModule,
    AuthManagerModule,
    DemoManagerModule,
    PicsurRoutesModule,
    PicsurLayersModule,
  ],
})
export class AppModule implements OnModuleInit {
  private readonly logger = new Logger(AppModule.name);

  onModuleInit() {
    const nodeVersion = process.version;
    if (!supportedNodeVersions.some((v) => semver.satisfies(nodeVersion, v))) {
      this.logger.error(
        `Unsupported Node version: ${nodeVersion}, Picsur may not work correctly.`,
      );

      this.logger.log(
        `Supported Node versions: ${supportedNodeVersions.join(', ')}`,
      );
    }
  }
}
