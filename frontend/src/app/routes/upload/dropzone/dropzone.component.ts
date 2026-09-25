import { Component, ChangeDetectionStrategy } from '@angular/core';
import { DropzoneComponent } from '@ngx-dropzone/cdk';

@Component({
  selector: 'my-dropzone',
  templateUrl: './dropzone.component.html',
  styleUrls: ['./dropzone.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class CustomDropzone extends DropzoneComponent {
  onContainerClick() {
    this.openFilePicker();
  }
}
