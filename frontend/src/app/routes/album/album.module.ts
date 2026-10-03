import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MomentModule } from 'ngx-moment';
import { AlbumDialogModule } from '../../components/album-dialog/album-dialog.module';

import { DialogManagerModule } from '../../util/dialog-manager/dialog-manager.module';
import { ErrorManagerModule } from '../../util/error-manager/error-manager.module';
import { AlbumComponent } from './album.component';
import { AlbumRoutingModule } from './album.routing.module';

@NgModule({
  imports: [
    CommonModule,
    ErrorManagerModule,
    DialogManagerModule,
    AlbumDialogModule,
    AlbumRoutingModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MomentModule,
    AlbumComponent,
  ],
})
export default class AlbumRouteModule {}
