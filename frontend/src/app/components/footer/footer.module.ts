import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { FooterComponent } from './footer.component';

@NgModule({
  imports: [CommonModule, FooterComponent],
  exports: [FooterComponent],
})
export class FooterModule {}
