import { Module } from '@nestjs/common';
import { ServerManagerModule } from '../../../managers/server/server-manager.module.js';
import { ServerController } from './server.controller.js';

@Module({
  imports: [ServerManagerModule],
  controllers: [ServerController],
})
export class ServerApiModule {}
