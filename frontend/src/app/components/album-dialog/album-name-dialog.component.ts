import { ChangeDetectionStrategy, Component, Inject } from '@angular/core';
import { FormControl, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

export interface AlbumNameDialogData {
  title: string;
  confirm: string;
  name?: string;
}

// Asks for the name of a new album, or a new name for one. Closes with the
// name, or nothing when cancelled.
@Component({
  selector: 'album-name-dialog',
  templateUrl: './album-name-dialog.component.html',
  styleUrls: ['./album-dialog.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class AlbumNameDialogComponent {
  public readonly name: FormControl<string>;

  constructor(
    public readonly dialogRef: MatDialogRef<AlbumNameDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public readonly data: AlbumNameDialogData,
  ) {
    this.name = new FormControl(data.name ?? '', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(100)],
    });
  }

  confirm() {
    const name = this.name.value.trim();
    if (name.length === 0 || this.name.invalid) return;
    this.dialogRef.close(name);
  }

  cancel() {
    this.dialogRef.close();
  }
}
