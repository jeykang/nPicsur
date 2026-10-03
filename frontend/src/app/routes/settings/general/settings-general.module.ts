import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { SettingsGeneralComponent } from './settings-general.component';
import { SettingsGeneralRoutingModule } from './settings-general.routing.module';
import { PrefOptionModule } from '../../../components/pref-option/pref-option.module';

@NgModule({
  imports: [
    CommonModule,
    SettingsGeneralRoutingModule,
    PrefOptionModule,
    SettingsGeneralComponent,
  ],
})
export default class SettingsGeneralRouteModule {}
