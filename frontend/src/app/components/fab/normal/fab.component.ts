import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { MatFabButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { MatIcon } from '@angular/material/icon';

@Component({
  selector: 'fab',
  templateUrl: './fab.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [MatFabButton, MatTooltip, MatIcon],
})
export class FabComponent {
  @Input('aria-label') ariaLabel = 'Floating action button';
  @Input() icon = 'add';
  @Input() color = 'primary';
  @Input('tooltip') tooltip: string;
}
