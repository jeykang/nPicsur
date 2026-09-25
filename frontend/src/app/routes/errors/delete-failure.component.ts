import { Component, ChangeDetectionStrategy } from '@angular/core';

@Component({
  template: `
    <h1>Failed to delete image!</h1>
    <p>
      It has most likely already been deleted, if this is not the case please
      report it as a bug.
    </p>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class ImageDeleteFailureComponent {}
