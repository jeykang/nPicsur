import {
  ChangeDetectionStrategy,
  Component,
  Inject,
  OnInit,
} from '@angular/core';
import { FormControl, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { EAlbumSummary } from 'picsur-shared/dist/dto/api/album.dto';
import { HasFailed } from 'picsur-shared/dist/types/failable';
import { AlbumService } from '../../services/api/album.service';
import { Logger } from '../../services/logger/logger.service';
import { ErrorService } from '../../util/error-manager/error.service';

export interface AddToAlbumDialogData {
  imageId: string;
}

// Puts an image in your albums, or takes it out of them
@Component({
  selector: 'add-to-album-dialog',
  templateUrl: './add-to-album-dialog.component.html',
  styleUrls: ['./album-dialog.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class AddToAlbumDialogComponent implements OnInit {
  private readonly logger = new Logger(AddToAlbumDialogComponent.name);

  public albums: EAlbumSummary[] | null = null;
  public busy = false;
  public readonly newName = new FormControl('', {
    nonNullable: true,
    validators: [Validators.maxLength(100)],
  });

  constructor(
    public readonly dialogRef: MatDialogRef<AddToAlbumDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public readonly data: AddToAlbumDialogData,
    private readonly albumService: AlbumService,
    private readonly errorService: ErrorService,
  ) {}

  ngOnInit() {
    this.load().catch(this.logger.error);
  }

  private async load() {
    const list = await this.albumService.list(100, 0, this.data.imageId);
    if (HasFailed(list)) {
      this.albums = [];
      return this.errorService.showFailure(list, this.logger);
    }
    this.albums = list.results;
  }

  async toggle(album: EAlbumSummary, add: boolean) {
    this.busy = true;
    const result = add
      ? await this.albumService.addImages(album.id, [this.data.imageId])
      : await this.albumService.removeImages(album.id, [this.data.imageId]);
    this.busy = false;

    if (HasFailed(result)) {
      this.errorService.showFailure(result, this.logger);
      return this.load();
    }
    this.replace({ ...result, contains_image: add });
  }

  async create() {
    const name = this.newName.value.trim();
    if (name.length === 0 || this.newName.invalid) return;

    this.busy = true;
    const album = await this.albumService.create(name);
    if (HasFailed(album)) {
      this.busy = false;
      return this.errorService.showFailure(album, this.logger);
    }
    const added = await this.albumService.addImages(album.id, [
      this.data.imageId,
    ]);
    this.busy = false;
    if (HasFailed(added)) {
      return this.errorService.showFailure(added, this.logger);
    }

    this.newName.reset();
    this.albums = [{ ...added, contains_image: true }, ...(this.albums ?? [])];
    this.errorService.success(`Added to ${added.name}`);
  }

  close() {
    this.dialogRef.close();
  }

  private replace(album: EAlbumSummary) {
    this.albums = (this.albums ?? []).map((a) =>
      a.id === album.id ? album : a,
    );
  }
}
