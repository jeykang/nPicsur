import { Component, Input, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'fab',
  templateUrl: './fab.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class FabComponent {
  @Input('aria-label') ariaLabel = 'Floating Action Button';
  @Input() icon = 'add';
  @Input() color = 'primary';
  @Input('tooltip') tooltip: string;
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  @Input() onClick: () => void = () => {};
}
