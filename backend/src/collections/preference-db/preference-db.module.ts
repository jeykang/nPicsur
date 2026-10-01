import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EUsrPreferenceBackend } from '../../database/entities/system/usr-preference.entity.js';
import { PreferenceCommonService } from './preference-common.service.js';
import { PreferenceDefaultsService } from './preference-defaults.service.js';
import { UsrPreferenceDbService } from './usr-preference-db.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([EUsrPreferenceBackend])],
  providers: [
    UsrPreferenceDbService,
    PreferenceDefaultsService,
    PreferenceCommonService,
  ],
  exports: [UsrPreferenceDbService],
})
export class PreferenceDbModule {}
