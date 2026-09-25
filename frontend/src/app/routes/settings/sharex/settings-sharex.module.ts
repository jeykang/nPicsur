import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ErrorManagerModule } from '../../../util/error-manager/error-manager.module';
import { SettingsShareXComponent } from './settings-sharex.component';
import { SettingsShareXRoutingModule } from './settings-sharex.routing.module';

@NgModule({
  declarations: [SettingsShareXComponent],
  imports: [
    CommonModule,
    ErrorManagerModule,

    SettingsShareXRoutingModule,
    MatSelectModule,
    MatInputModule,
    MatButtonModule,
  ],
})
export default class SettingsShareXRouteModule {}
