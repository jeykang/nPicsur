import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { SettingsServerComponent } from './settings-server.component';
import { SettingsServerRoutingModule } from './settings-server.routing.module';
import { DialogManagerModule } from '../../../util/dialog-manager/dialog-manager.module';
import { ErrorManagerModule } from '../../../util/error-manager/error-manager.module';

@NgModule({
  declarations: [SettingsServerComponent],
  imports: [
    CommonModule,
    SettingsServerRoutingModule,
    FormsModule,
    ReactiveFormsModule,
    ErrorManagerModule,
    DialogManagerModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatSlideToggleModule,
  ],
})
export default class SettingsServerRouteModule {}
