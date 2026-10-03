import { Component, ChangeDetectionStrategy } from '@angular/core';

@Component({
  template: `
    <h1>The image could not be deleted</h1>
    <p>It may have been deleted already.</p>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class ImageDeleteFailureComponent {}
