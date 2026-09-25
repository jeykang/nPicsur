import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatTableModule } from '@angular/material/table';
import { MomentModule } from 'ngx-moment';
import { FabModule } from '../../../components/fab/fab.module';
import { DialogManagerModule } from '../../../util/dialog-manager/dialog-manager.module';
import { ErrorManagerModule } from '../../../util/error-manager/error-manager.module';
import { ApiKeyCreatedDialogComponent } from './apikey-created-dialog/apikey-created-dialog.component';
import { SettingsApiKeyEditorComponent } from './apikey-editor/apikey-editor.component';
import { SettingsApiKeysComponent } from './settings-apikeys.component';
import { SettingsApiKeysRoutingModule } from './settings-apikeys.routing.module';

@NgModule({
  declarations: [
    SettingsApiKeysComponent,
    SettingsApiKeyEditorComponent,
    ApiKeyCreatedDialogComponent,
  ],
  imports: [
    CommonModule,
    ErrorManagerModule,
    DialogManagerModule,

    SettingsApiKeysRoutingModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatTableModule,
    MatPaginatorModule,
    MatInputModule,
    MomentModule,
    ReactiveFormsModule,
    FabModule,
  ],
})
export default class SettingsApiKeysRouteModule {}
