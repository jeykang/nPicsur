import { Module } from '@nestjs/common';
import { PreferenceDbModule } from '../../../collections/preference-db/preference-db.module.js';
import { UsrPrefController } from './usr-pref.controller.js';

@Module({
  imports: [PreferenceDbModule],
  controllers: [UsrPrefController],
})
export class PrefModule {}
