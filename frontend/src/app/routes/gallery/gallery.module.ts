import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MomentModule } from 'ngx-moment';
import { MasonryModule } from '../../components/masonry/masonry.module';
import { PaginatorModule } from '../../components/paginator/paginator.module';
import { PicsurImgModule } from '../../components/picsur-img/picsur-img.module';
import { PipesModule } from '../../pipes/pipes.module';
import { ErrorManagerModule } from '../../util/error-manager/error-manager.module';
import { GalleryComponent } from './gallery.component';
import { GalleryRoutingModule } from './gallery.routing.module';

@NgModule({
  declarations: [GalleryComponent],
  imports: [
    CommonModule,
    ErrorManagerModule,

    GalleryRoutingModule,
    MatCardModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MasonryModule,
    PaginatorModule,
    PicsurImgModule,
    MomentModule,
    PipesModule,
  ],
})
export default class GalleryRouteModule {}
