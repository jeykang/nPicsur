import { Component, ChangeDetectionStrategy } from '@angular/core';

@Component({
  template: `
    <h1>Image Successfully Deleted!</h1>
    <p>Thank you for using Picsur.</p>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class ImageDeleteSuccessComponent {}
