import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AutoUnsubscribe } from 'ngx-auto-unsubscribe-decorator';
import { EAlbumSummary } from 'picsur-shared/dist/dto/api/album.dto';
import { ImageFileType } from 'picsur-shared/dist/dto/mimes.dto';
import { HasFailed } from 'picsur-shared/dist/types/failable';
import {
  AlbumNameDialogComponent,
  AlbumNameDialogData,
} from '../../components/album-dialog/album-name-dialog.component';
import { AlbumService } from '../../services/api/album.service';
import { ImageService } from '../../services/api/image.service';
import { Logger } from '../../services/logger/logger.service';
import { BSScreenSize, BootstrapService } from '../../util/bootstrap.service';
import { DialogService } from '../../util/dialog-manager/dialog.service';
import { ErrorService } from '../../util/error-manager/error.service';

@Component({
  templateUrl: './albums.component.html',
  styleUrls: ['./albums.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class AlbumsComponent implements OnInit {
  private readonly logger = new Logger(AlbumsComponent.name);

  albums: EAlbumSummary[] | null = null;
  columns = 1;

  page = 1;
  pages = 1;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly bootstrapService: BootstrapService,
    private readonly albumService: AlbumService,
    private readonly imageService: ImageService,
    private readonly dialogService: DialogService,
    private readonly errorService: ErrorService,
  ) {}

  ngOnInit() {
    this.subscribeMobile();
    this.load().catch(this.logger.error);
  }

  private async load() {
    const page = Number(this.route.snapshot.paramMap.get('page') ?? '');
    this.page = isNaN(page) || page <= 0 ? 1 : page;

    const list = await this.albumService.list(24, this.page - 1);
    if (HasFailed(list)) {
      this.albums = [];
      return this.errorService.showFailure(list, this.logger);
    }

    this.pages = list.pages;
    this.albums = list.results;
  }

  @AutoUnsubscribe()
  private subscribeMobile() {
    return this.bootstrapService.screenSize().subscribe((size) => {
      if (size <= BSScreenSize.sm) {
        this.columns = 1;
      } else if (size <= BSScreenSize.lg) {
        this.columns = 2;
      } else {
        this.columns = 3;
      }
    });
  }

  getCoverUrl(album: EAlbumSummary) {
    if (album.cover_id === null) return null;
    return (
      this.imageService.GetImageURL(album.cover_id, ImageFileType.QOI) +
      '?height=480&shrinkonly=yes'
    );
  }

  openAlbum(album: EAlbumSummary) {
    this.router.navigate(['/album', album.id]);
  }

  async createAlbum() {
    const name: string | undefined = await this.dialogService.showCustomDialog(
      AlbumNameDialogComponent,
      {
        title: 'New album',
        confirm: 'Create',
      } satisfies AlbumNameDialogData,
    );
    if (!name) return;

    const album = await this.albumService.create(name);
    if (HasFailed(album)) {
      return this.errorService.showFailure(album, this.logger);
    }
    this.openAlbum(album);
  }

  gotoPage(page: number) {
    this.router.navigate(['/albums', page]).then(() => {
      this.load().catch(this.logger.error);
    });
  }
}
