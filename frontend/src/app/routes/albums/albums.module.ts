import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MomentModule } from 'ngx-moment';
import { AlbumDialogModule } from '../../components/album-dialog/album-dialog.module';
import { FabModule } from '../../components/fab/fab.module';
import { MasonryModule } from '../../components/masonry/masonry.module';
import { PaginatorModule } from '../../components/paginator/paginator.module';
import { PicsurImgModule } from '../../components/picsur-img/picsur-img.module';
import { PipesModule } from '../../pipes/pipes.module';
import { DialogManagerModule } from '../../util/dialog-manager/dialog-manager.module';
import { ErrorManagerModule } from '../../util/error-manager/error-manager.module';
import { AlbumsComponent } from './albums.component';
import { AlbumsRoutingModule } from './albums.routing.module';

@NgModule({
  declarations: [AlbumsComponent],
  imports: [
    CommonModule,
    ErrorManagerModule,
    DialogManagerModule,
    AlbumDialogModule,

    AlbumsRoutingModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    FabModule,
    MasonryModule,
    PaginatorModule,
    PicsurImgModule,
    MomentModule,
    PipesModule,
  ],
})
export default class AlbumsRouteModule {}
