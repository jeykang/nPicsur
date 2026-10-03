import { Component, Inject, ChangeDetectionStrategy } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ImageService } from '../../../services/api/image.service';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatSelect, MatOption } from '@angular/material/select';
import { MatTooltip } from '@angular/material/tooltip';
import { MatInput } from '@angular/material/input';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { CopyFieldComponent } from '../../../components/copy-field/copy-field.component';
import { MatButton } from '@angular/material/button';

// A value the server does not accept is left out of the address, instead
// of making it leave out every option
function inRange(
  value: number | null | undefined,
  min: number,
  max: number,
): number | undefined {
  if (value === null || value === undefined) return undefined;
  return Number.isInteger(value) && value >= min && value <= max
    ? value
    : undefined;
}

export interface CustomizeDialogData {
  imageID: string;
  formatOptions: {
    value: string;
    key: string;
  }[];
  selectedFormat: string;
}

@Component({
  selector: 'customize-dialog',
  templateUrl: './customize-dialog.component.html',
  styleUrls: ['./customize-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    MatFormField,
    MatLabel,
    MatSelect,
    MatOption,
    MatTooltip,
    MatInput,
    ReactiveFormsModule,
    FormsModule,
    MatSlideToggle,
    CopyFieldComponent,
    MatButton,
  ],
})
export class CustomizeDialogComponent {
  public sizeTooltip = 'Leave empty to keep original aspect ratio';

  public rotationOptions = [0, 90, 180, 270];
  public formatOptions: {
    value: string;
    key: string;
  }[];

  public imageID: string;
  public selectedFormat: string;
  public height: number;
  public width: number;
  public rotate: number;
  public flipx: boolean;
  public flipy: boolean;
  public shrinkonly: boolean;
  public greyscale: boolean;
  public noalpha: boolean;
  public negative: boolean;
  public quality: number;

  constructor(
    public readonly dialogRef: MatDialogRef<CustomizeDialogComponent>,
    private readonly imageService: ImageService,
    @Inject(MAT_DIALOG_DATA) data: CustomizeDialogData,
  ) {
    this.formatOptions = data.formatOptions;
    this.selectedFormat = data.selectedFormat;
    this.imageID = data.imageID;
  }

  close() {
    this.dialogRef.close();
  }

  getURL(): string {
    return this.imageService.GetImageURLCustomized(
      this.imageID,
      this.selectedFormat,
      {
        height: inRange(this.height, 1, 32767),
        width: inRange(this.width, 1, 32767),
        rotate: this.rotate ?? undefined,
        quality: inRange(this.quality, 1, 100),
        flipx: this.flipx,
        flipy: this.flipy,
        shrinkonly: this.shrinkonly,
        greyscale: this.greyscale,
        noalpha: this.noalpha,
        negative: this.negative,
      },
    );
  }
}
