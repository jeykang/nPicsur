import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { SettingsAccountComponent } from './settings-account.component';
import { SettingsAccountRoutingModule } from './settings-account.routing.module';
import { ErrorManagerModule } from '../../../util/error-manager/error-manager.module';

@NgModule({
  declarations: [SettingsAccountComponent],
  imports: [
    CommonModule,
    ErrorManagerModule,
    SettingsAccountRoutingModule,
    FormsModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
  ],
})
export default class SettingsAccountRouteModule {}
