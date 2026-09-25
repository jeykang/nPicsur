import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { InviewDirective } from './inview.directive';
import { PicsurImgComponent } from './picsur-img.component';

@NgModule({
  declarations: [PicsurImgComponent],
  imports: [
    CommonModule,
    MatProgressSpinnerModule,
    MatIconModule,
    InviewDirective,
  ],
  exports: [PicsurImgComponent],
})
export class PicsurImgModule {}
