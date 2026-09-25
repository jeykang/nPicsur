import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EServerSettingBackend } from '../../database/entities/system/server-setting.entity.js';
import { ServerSettingsDbService } from './server-settings-db.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([EServerSettingBackend])],
  providers: [ServerSettingsDbService],
  exports: [ServerSettingsDbService],
})
export class ServerSettingsDbModule {}
