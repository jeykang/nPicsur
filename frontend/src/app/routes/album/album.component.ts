import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AutoUnsubscribe } from 'ngx-auto-unsubscribe-decorator';
import { EAlbumSummary } from 'picsur-shared/dist/dto/api/album.dto';
import { Permission } from 'picsur-shared/dist/dto/permissions.enum';
import { EImage } from 'picsur-shared/dist/entities/image.entity';
import { EPublicUser } from 'picsur-shared/dist/entities/user.entity';
import { Fail, FT, HasFailed } from 'picsur-shared/dist/types/failable';
import { combineLatest } from 'rxjs';
import {
  AlbumNameDialogComponent,
  AlbumNameDialogData,
} from '../../components/album-dialog/album-name-dialog.component';
import { AlbumService } from '../../services/api/album.service';
import { ImageService } from '../../services/api/image.service';
import { InfoService } from '../../services/api/info.service';
import { PermissionService } from '../../services/api/permission.service';
import { UserService } from '../../services/api/user.service';
import { Logger } from '../../services/logger/logger.service';
import { BSScreenSize, BootstrapService } from '../../util/bootstrap.service';
import { ClipboardService } from '../../util/clipboard.service';
import { DialogService } from '../../util/dialog-manager/dialog.service';
import { ErrorService } from '../../util/error-manager/error.service';

@Component({
  templateUrl: './album.component.html',
  styleUrls: ['./album.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class AlbumComponent implements OnInit {
  private readonly logger = new Logger(AlbumComponent.name);

  album: EAlbumSummary | null = null;
  owner: EPublicUser | null = null;
  images: EImage[] | null = null;
  columns = 1;
  canManage = false;

  page = 1;
  pages = 1;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly bootstrapService: BootstrapService,
    private readonly albumService: AlbumService,
    private readonly imageService: ImageService,
    private readonly infoService: InfoService,
    private readonly permissionService: PermissionService,
    private readonly userService: UserService,
    private readonly clipboard: ClipboardService,
    private readonly dialogService: DialogService,
    private readonly errorService: ErrorService,
  ) {}

  private get id(): string {
    return this.route.snapshot.paramMap.get('id') ?? '';
  }

  ngOnInit() {
    this.subscribeMobile();
    this.subscribeManage();
    this.load().catch(this.logger.error);
  }

  private async load() {
    const page = Number(this.route.snapshot.paramMap.get('page') ?? '');
    this.page = isNaN(page) || page <= 0 ? 1 : page;

    const [info, images] = await Promise.all([
      this.albumService.info(this.id),
      this.albumService.images(this.id, 24, this.page - 1),
    ]);
    if (HasFailed(info)) {
      if (info.getType() === FT.NotFound) {
        return this.router.navigate(['/error/404'], { replaceUrl: true });
      }
      return this.errorService.showFailure(info, this.logger);
    }
    if (HasFailed(images)) {
      return this.errorService.showFailure(images, this.logger);
    }

    this.album = info.album;
    this.owner = info.user;
    this.pages = images.pages;
    this.images = images.results;
    this.updateCanManage();
  }

  @AutoUnsubscribe()
  private subscribeManage() {
    return combineLatest([
      this.permissionService.live,
      this.userService.live,
    ]).subscribe(() => this.updateCanManage());
  }

  private updateCanManage() {
    const permissions = this.permissionService.snapshot;
    const isOwner =
      this.album !== null &&
      this.album.user_id === this.userService.snapshot?.id;
    this.canManage =
      permissions.includes(Permission.ImageAdmin) ||
      (isOwner && permissions.includes(Permission.ImageManage));
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

  getThumbnailUrl(image: EImage) {
    return this.imageService.GetThumbnailURL(image.id);
  }

  viewImage(image: EImage) {
    this.router.navigate(['/view', image.id]);
  }

  async copyLink() {
    const link = `${this.infoService.getHostname(true)}/album/${this.id}`;
    if (!(await this.clipboard.copy(link))) {
      return this.errorService.showFailure(
        Fail(FT.Internal, 'Failed to copy the link to the clipboard'),
        this.logger,
      );
    }
    this.errorService.success('Link copied to clipboard');
  }

  async rename() {
    if (this.album === null) return;
    const name: string | undefined = await this.dialogService.showCustomDialog(
      AlbumNameDialogComponent,
      {
        title: 'Rename album',
        confirm: 'Rename',
        name: this.album.name,
      } satisfies AlbumNameDialogData,
    );
    if (!name) return;

    const result = await this.albumService.rename(this.album.id, name);
    if (HasFailed(result)) {
      return this.errorService.showFailure(result, this.logger);
    }
    this.album = result;
  }

  async deleteAlbum() {
    if (this.album === null) return;
    const pressed = await this.dialogService.showDialog({
      title: `Are you sure you want to delete ${this.album.name}?`,
      description: 'The images in it are not deleted.',
      buttons: [
        { name: 'cancel', text: 'Cancel' },
        { name: 'delete', text: 'Delete', color: 'warn' },
      ],
    });
    if (pressed !== 'delete') return;

    const result = await this.albumService.delete(this.album.id);
    if (HasFailed(result)) {
      return this.errorService.showFailure(result, this.logger);
    }
    this.errorService.success('Album deleted');
    this.router.navigate(['/albums']);
  }

  async removeImage(image: EImage) {
    if (this.album === null) return;
    const result = await this.albumService.removeImages(this.album.id, [
      image.id,
    ]);
    if (HasFailed(result)) {
      return this.errorService.showFailure(result, this.logger);
    }
    this.album = result;
    this.images = (this.images ?? []).filter((i) => i.id !== image.id);
    this.errorService.success('Image removed from the album');
  }

  gotoPage(page: number) {
    this.router.navigate(['/album', this.id, page]).then(() => {
      this.load().catch(this.logger.error);
    });
  }
}
