import { Component, ChangeDetectionStrategy } from '@angular/core';

@Component({
  template: `
    <h1>401 - Permission denied</h1>
    <p>You do not have access to this page.</p>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class E401Component {}
