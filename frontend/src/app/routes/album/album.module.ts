import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MomentModule } from 'ngx-moment';
import { AlbumDialogModule } from '../../components/album-dialog/album-dialog.module';
import { MasonryModule } from '../../components/masonry/masonry.module';
import { PaginatorModule } from '../../components/paginator/paginator.module';
import { PicsurImgModule } from '../../components/picsur-img/picsur-img.module';
import { PipesModule } from '../../pipes/pipes.module';
import { DialogManagerModule } from '../../util/dialog-manager/dialog-manager.module';
import { ErrorManagerModule } from '../../util/error-manager/error-manager.module';
import { AlbumComponent } from './album.component';
import { AlbumRoutingModule } from './album.routing.module';

@NgModule({
  declarations: [AlbumComponent],
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
    MasonryModule,
    PaginatorModule,
    PicsurImgModule,
    MomentModule,
    PipesModule,
  ],
})
export default class AlbumRouteModule {}
