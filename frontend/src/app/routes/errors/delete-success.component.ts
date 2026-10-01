import { Component, ChangeDetectionStrategy } from '@angular/core';

@Component({
  template: '<h1>The image is deleted</h1>',
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class ImageDeleteSuccessComponent {}
