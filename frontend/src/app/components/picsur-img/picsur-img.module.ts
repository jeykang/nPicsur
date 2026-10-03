import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { InviewDirective } from './inview.directive';
import { PicsurImgComponent } from './picsur-img.component';

@NgModule({
  imports: [
    CommonModule,
    MatProgressSpinnerModule,
    MatIconModule,
    InviewDirective,
    PicsurImgComponent,
  ],
  exports: [PicsurImgComponent],
})
export class PicsurImgModule {}
