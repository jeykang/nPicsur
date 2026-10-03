import { ChangeDetectionStrategy, Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Fail, FT } from 'picsur-shared/dist/types/failable';
import { Logger } from '../../../../services/logger/logger.service';
import { ClipboardService } from '../../../../util/clipboard.service';
import { ErrorService } from '../../../../util/error-manager/error.service';
import {
  MatFormField,
  MatLabel,
  MatSuffix,
} from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatIconButton, MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';

export interface ApiKeyCreatedDialogData {
  key: string;
}

// Shows a new api key, the only time it can be seen
@Component({
  selector: 'apikey-created-dialog',
  templateUrl: './apikey-created-dialog.component.html',
  styleUrls: ['./apikey-created-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    MatFormField,
    MatLabel,
    MatInput,
    MatIconButton,
    MatSuffix,
    MatIcon,
    MatButton,
  ],
})
export class ApiKeyCreatedDialogComponent {
  private readonly logger = new Logger(ApiKeyCreatedDialogComponent.name);

  constructor(
    public readonly dialogRef: MatDialogRef<ApiKeyCreatedDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public readonly data: ApiKeyCreatedDialogData,
    private readonly clipboard: ClipboardService,
    private readonly errorService: ErrorService,
  ) {}

  async copy() {
    if (!(await this.clipboard.copy(this.data.key))) {
      return this.errorService.showFailure(
        Fail(FT.Internal, 'Failed to copy the API key to the clipboard'),
        this.logger,
      );
    }
    this.errorService.success('API key copied to the clipboard');
  }

  close() {
    this.dialogRef.close();
  }
}
