import { ChangeDetectionStrategy, Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Fail, FT } from 'picsur-shared/dist/types/failable';
import { Logger } from '../../../../services/logger/logger.service';
import { ClipboardService } from '../../../../util/clipboard.service';
import { ErrorService } from '../../../../util/error-manager/error.service';

export interface ApiKeyCreatedDialogData {
  key: string;
}

// Shows a new api key, the only time it can be seen
@Component({
  selector: 'apikey-created-dialog',
  templateUrl: './apikey-created-dialog.component.html',
  styleUrls: ['./apikey-created-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
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
        Fail(FT.Internal, 'Failed to copy api key to clipboard'),
        this.logger,
      );
    }
    this.errorService.success('Api key copied to clipboard');
  }

  close() {
    this.dialogRef.close();
  }
}
