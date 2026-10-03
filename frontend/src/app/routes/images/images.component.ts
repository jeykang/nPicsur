import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { AutoUnsubscribe } from 'ngx-auto-unsubscribe-decorator';
import { EAlbumSummary } from 'picsur-shared/dist/dto/api/album.dto';
import { ImageListFilters } from 'picsur-shared/dist/dto/api/image-manage.dto';
import { AnimFileType, ImageFileType } from 'picsur-shared/dist/dto/mimes.dto';
import { EImage } from 'picsur-shared/dist/entities/image.entity';
import { HasFailed } from 'picsur-shared/dist/types/failable';
import { IsEntityID } from 'picsur-shared/dist/validators/entity-id.validator';
import {
  BehaviorSubject,
  Observable,
  combineLatest,
  debounceTime,
  filter,
  map,
  merge,
  switchMap,
  timer,
} from 'rxjs';
import {
  AddToAlbumDialogComponent,
  AddToAlbumDialogData,
} from '../../components/album-dialog/add-to-album-dialog.component';
import { AlbumService } from '../../services/api/album.service';
import { ImageService } from '../../services/api/image.service';
import { UserService } from '../../services/api/user.service';
import { Logger } from '../../services/logger/logger.service';
import { BSScreenSize, BootstrapService } from '../../util/bootstrap.service';
import { DialogService } from '../../util/dialog-manager/dialog.service';
import { ErrorService } from '../../util/error-manager/error.service';
import { MatButton } from '@angular/material/button';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatSelect, MatOption } from '@angular/material/select';
import {
  MatCard,
  MatCardHeader,
  MatCardAvatar,
  MatCardTitle,
  MatCardSubtitle,
  MatCardImage,
  MatCardActions,
} from '@angular/material/card';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MasonryComponent } from '../../components/masonry/masonry.component';
import { MasonryItemDirective } from '../../components/masonry/masonry-item.directive';
import { MatCheckbox } from '@angular/material/checkbox';
import { PicsurImgComponent } from '../../components/picsur-img/picsur-img.component';
import { PaginatorComponent } from '../../components/paginator/paginator.component';
import { MomentModule } from 'ngx-moment';
import { TruncatePipe } from '../../pipes/truncate.pipe';

const Day = 24 * 60 * 60 * 1000;

// How images are stored. JPEG, PNG, WebP and GIF uploads are kept as they
// are. Other still images, and every still image uploaded before Picsur 0.7,
// are stored as QOI, other animations as WebP.
const FormatFilters: Record<string, { name: string; types: string[] }> = {
  jpeg: { name: 'JPEG', types: [ImageFileType.JPEG] },
  png: { name: 'PNG', types: [ImageFileType.PNG, AnimFileType.APNG] },
  webp: { name: 'WebP', types: [ImageFileType.WEBP, AnimFileType.WEBP] },
  gif: { name: 'GIF', types: [AnimFileType.GIF] },
  qoi: { name: 'QOI', types: [ImageFileType.QOI] },
};

const UploadedFilters: Record<
  string,
  { name: string; after?: number; before?: number }
> = {
  day: { name: 'Last 24 hours', after: Day },
  week: { name: 'Last 7 days', after: 7 * Day },
  month: { name: 'Last 30 days', after: 30 * Day },
  year: { name: 'Last year', after: 365 * Day },
  older: { name: 'Over a year ago', before: 365 * Day },
};

// What is looked for, kept in the address so it survives reloading
interface Search {
  q: string;
  format: string | null;
  album: string | null;
  uploaded: string | null;
}

const PageSize = 24;

@Component({
  templateUrl: './images.component.html',
  styleUrls: ['./images.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    MatButton,
    MatFormField,
    MatLabel,
    MatInput,
    ReactiveFormsModule,
    MatSelect,
    MatOption,
    MatCard,
    MatProgressSpinner,
    MasonryComponent,
    MasonryItemDirective,
    MatCardHeader,
    MatCheckbox,
    MatCardAvatar,
    MatCardTitle,
    MatCardSubtitle,
    PicsurImgComponent,
    MatCardImage,
    MatCardActions,
    PaginatorComponent,
    MomentModule,
    TruncatePipe,
  ],
})
export class ImagesComponent implements OnInit {
  private readonly logger: Logger = new Logger(ImagesComponent.name);

  readonly formatOptions = Object.entries(FormatFilters).map(
    ([key, { name }]) => ({ key, name }),
  );
  readonly uploadedOptions = Object.entries(UploadedFilters).map(
    ([key, { name }]) => ({ key, name }),
  );

  imagesSub = new BehaviorSubject<EImage[] | null>(null);
  columns = 1;

  public get images() {
    const value = this.imagesSub.value;
    return (
      value?.filter(
        (i) => i.expires_at === null || i.expires_at > new Date(),
      ) ?? null
    );
  }

  page = 1;
  pages = 1;

  readonly query = new FormControl('', { nonNullable: true });
  search: Search = { q: '', format: null, album: null, uploaded: null };
  albums: EAlbumSummary[] = [];

  selecting = false;
  readonly selected = new Set<string>();
  busy = false;

  // What was searched for by typing, the box can be ahead of the address
  private typed: string | null = null;
  // Counts the lists asked for, an answer is only used for the last one
  private loads = 0;

  public get searching() {
    const { q, format, album, uploaded } = this.search;
    return q !== '' || format !== null || album !== null || uploaded !== null;
  }

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly bootstrapService: BootstrapService,
    private readonly userService: UserService,
    private readonly imageService: ImageService,
    private readonly albumService: AlbumService,
    private readonly errorService: ErrorService,
    private readonly dialogService: DialogService,
  ) {}

  ngOnInit() {
    this.subscribeMobile();
    this.subscribeRoute();
    this.subscribeQuery();
    this.subscribeImages();
    this.loadAlbums().catch(this.logger.error);
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

  // The page and what is looked for come from the address
  @AutoUnsubscribe()
  private subscribeRoute() {
    return combineLatest([
      this.route.paramMap,
      this.route.queryParamMap,
      this.userService.live.pipe(filter((user) => user !== null)),
    ])
      .pipe(
        // The page and the query parameters change one after the other
        debounceTime(0),
      )
      .subscribe(([params, query]) => {
        let page = Number(params.get('page') ?? '');
        if (isNaN(page) || page <= 0) page = 1;
        this.page = page;

        // Only what the api takes, anything else is left out
        const option = (name: string, options: object) => {
          const value = query.get(name);
          return value !== null && Object.hasOwn(options, value) ? value : null;
        };
        const album = query.get('album');
        this.search = {
          q: (query.get('q') ?? '').trim().slice(0, 100),
          format: option('format', FormatFilters),
          album:
            album !== null && IsEntityID().safeParse(album).success
              ? album
              : null,
          uploaded: option('uploaded', UploadedFilters),
        };
        if (this.search.q !== this.typed) {
          this.query.setValue(this.search.q, { emitEvent: false });
        }
        this.typed = null;
        // What is selected is always in sight
        this.selected.clear();

        this.loadImages().catch(this.logger.error);
      });
  }

  @AutoUnsubscribe()
  private subscribeQuery() {
    return this.query.valueChanges
      .pipe(
        debounceTime(300),
        map((q) => q.trim()),
        filter((q) => q !== this.search.q),
      )
      .subscribe((q) => {
        this.typed = q;
        this.setSearch({ q });
      });
  }

  private async loadImages() {
    const load = ++this.loads;
    const list = await this.imageService.ListMyImages(
      PageSize,
      this.page - 1,
      this.getFilters(),
    );
    // Another page or search was asked for in the meantime
    if (load !== this.loads) return;
    if (HasFailed(list)) {
      return this.errorService.showFailure(list, this.logger);
    }

    this.pages = list.pages;
    this.imagesSub.next(list.results);

    // Also what was selected while this page was loading
    const shown = new Set(list.results.map((image) => image.id));
    for (const id of this.selected) {
      if (!shown.has(id)) this.selected.delete(id);
    }
  }

  private async loadAlbums() {
    const albums = await this.albumService.list(100, 0);
    if (HasFailed(albums)) return albums.print(this.logger);
    this.albums = albums.results;
  }

  private getFilters(): ImageListFilters {
    const { q, format, album, uploaded } = this.search;
    const filters: ImageListFilters = {};
    if (q !== '') filters.search = q;
    if (format !== null) filters.filetypes = FormatFilters[format].types;
    if (album !== null) filters.album_id = album;
    if (uploaded !== null) {
      const { after, before } = UploadedFilters[uploaded];
      if (after !== undefined) {
        filters.uploaded_after = new Date(Date.now() - after);
      }
      if (before !== undefined) {
        filters.uploaded_before = new Date(Date.now() - before);
      }
    }
    return filters;
  }

  // Starts again at the first page
  setSearch(change: Partial<Search>) {
    const search = { ...this.search, ...change };
    const queryParams: Params = {};
    if (search.q !== '') queryParams['q'] = search.q;
    if (search.format !== null) queryParams['format'] = search.format;
    if (search.album !== null) queryParams['album'] = search.album;
    if (search.uploaded !== null) queryParams['uploaded'] = search.uploaded;
    this.router.navigate(['/images', 1], { queryParams });
  }

  clearSearch() {
    this.setSearch({ q: '', format: null, album: null, uploaded: null });
  }

  @AutoUnsubscribe()
  private subscribeImages() {
    // Make sure we only get populated images
    const filteredImagesSub: Observable<EImage[]> = this.imagesSub.pipe(
      filter((images) => images !== null),
    ) as Observable<EImage[]>;

    const mappedImagesSub: Observable<EImage> = filteredImagesSub.pipe(
      // Everytime we get a new array, we want merge a mapping of that array
      // In this mapping, each image will emit itself on the expire date
      switchMap((images: EImage[]) =>
        merge(
          ...images
            .filter((i) => i.expires_at !== null)
            .map((i) => timer(i.expires_at ?? new Date(0)).pipe(map(() => i))),
        ),
      ),
    ) as Observable<EImage>;

    return mappedImagesSub.subscribe((image) => {
      this.selected.delete(image.id);
      this.imagesSub.next(
        this.images?.filter((i) => i.id !== image.id) ?? null,
      );
    });
  }

  getThumbnailUrl(image: EImage) {
    return this.imageService.GetThumbnailURL(image.id);
  }

  viewImage(image: EImage) {
    if (this.selecting) return this.toggleSelected(image);
    this.router.navigate(['/view', image.id]);
  }

  // Selecting several images at once ========================================

  startSelecting() {
    this.selecting = true;
  }

  stopSelecting() {
    this.selecting = false;
    this.selected.clear();
  }

  toggleSelected(image: EImage) {
    if (this.selected.has(image.id)) this.selected.delete(image.id);
    else this.selected.add(image.id);
  }

  selectAll() {
    for (const image of this.images ?? []) this.selected.add(image.id);
  }

  async addToAlbum(image?: EImage) {
    const imageIds = image === undefined ? [...this.selected] : [image.id];
    if (imageIds.length === 0) return;
    await this.dialogService.showCustomDialog(AddToAlbumDialogComponent, {
      imageIds,
    } satisfies AddToAlbumDialogData);
    await this.loadAlbums();
    // Images taken out of the album that is shown are no longer listed
    if (this.search.album !== null) await this.loadImages();
  }

  async deleteImage(image: EImage) {
    await this.deleteImages([image.id]);
  }

  async deleteSelected() {
    await this.deleteImages([...this.selected]);
  }

  private async deleteImages(ids: string[]) {
    if (ids.length === 0) return;
    const pressedButton = await this.dialogService.showDialog({
      title:
        ids.length === 1
          ? 'Delete this image?'
          : `Delete ${ids.length} images?`,
      description: 'This cannot be undone.',
      buttons: [
        {
          name: 'cancel',
          text: 'Cancel',
        },
        {
          color: 'warn',
          name: 'delete',
          text: 'Delete',
        },
      ],
    });
    if (pressedButton !== 'delete') return;

    this.busy = true;
    const result = await this.imageService.DeleteImages(ids);
    this.busy = false;
    if (HasFailed(result)) {
      return this.errorService.showFailure(result, this.logger);
    }

    const deleted = result.images.length;
    this.errorService.success(
      deleted === 1 ? 'Image deleted' : `${deleted} images deleted`,
    );
    for (const image of result.images) this.selected.delete(image.id);
    if (this.selected.size === 0) this.selecting = false;

    // The next ones move up, or this page is gone when it is the last one
    if (
      deleted === this.images?.length &&
      this.page > 1 &&
      this.page >= this.pages
    ) {
      this.gotoPage(this.page - 1);
    } else {
      await this.loadImages();
    }
  }

  gotoPage(page: number) {
    this.router.navigate(['/images', page], {
      queryParamsHandling: 'preserve',
    });
  }
}
