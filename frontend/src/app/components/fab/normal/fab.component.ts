import { Component, Input, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'fab',
  templateUrl: './fab.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class FabComponent {
  @Input('aria-label') ariaLabel = 'Floating action button';
  @Input() icon = 'add';
  @Input() color = 'primary';
  @Input('tooltip') tooltip: string;
  @Input() onClick: () => void = () => {};
}
