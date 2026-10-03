import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MomentModule } from 'ngx-moment';

import { ErrorManagerModule } from '../../util/error-manager/error-manager.module';
import { GalleryComponent } from './gallery.component';
import { GalleryRoutingModule } from './gallery.routing.module';

@NgModule({
  imports: [
    CommonModule,
    ErrorManagerModule,
    GalleryRoutingModule,
    MatCardModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MomentModule,
    GalleryComponent,
  ],
})
export default class GalleryRouteModule {}
