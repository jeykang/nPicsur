import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MomentModule } from 'ngx-moment';
import { AlbumDialogModule } from '../../components/album-dialog/album-dialog.module';
import { MasonryModule } from '../../components/masonry/masonry.module';
import { PaginatorModule } from '../../components/paginator/paginator.module';
import { PicsurImgModule } from '../../components/picsur-img/picsur-img.module';
import { PipesModule } from '../../pipes/pipes.module';
import { DialogManagerModule } from '../../util/dialog-manager/dialog-manager.module';
import { ErrorManagerModule } from '../../util/error-manager/error-manager.module';
import { ImagesComponent } from './images.component';
import { ImagesRoutingModule } from './images.routing.module';

@NgModule({
  imports: [
    CommonModule,
    ErrorManagerModule,
    DialogManagerModule,
    AlbumDialogModule,
    ImagesRoutingModule,
    ReactiveFormsModule,
    MatCardModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MasonryModule,
    PaginatorModule,
    PicsurImgModule,
    MomentModule,
    PipesModule,
    ImagesComponent,
  ],
})
export default class ImagesRouteModule {}
