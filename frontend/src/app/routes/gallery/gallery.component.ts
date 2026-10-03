import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AutoUnsubscribe } from 'ngx-auto-unsubscribe-decorator';
import { EGalleryImage } from 'picsur-shared/dist/dto/api/gallery.dto';
import { HasFailed } from 'picsur-shared/dist/types/failable';
import { ImageService } from '../../services/api/image.service';
import { Logger } from '../../services/logger/logger.service';
import { BSScreenSize, BootstrapService } from '../../util/bootstrap.service';
import { ErrorService } from '../../util/error-manager/error.service';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MasonryComponent } from '../../components/masonry/masonry.component';
import { MasonryItemDirective } from '../../components/masonry/masonry-item.directive';
import {
  MatCard,
  MatCardHeader,
  MatCardTitle,
  MatCardSubtitle,
  MatCardImage,
  MatCardActions,
} from '@angular/material/card';
import { PicsurImgComponent } from '../../components/picsur-img/picsur-img.component';
import { MatButton } from '@angular/material/button';
import { PaginatorComponent } from '../../components/paginator/paginator.component';
import { MomentModule } from 'ngx-moment';
import { TruncatePipe } from '../../pipes/truncate.pipe';

// The images their owners chose to show to everyone
@Component({
  templateUrl: './gallery.component.html',
  styleUrls: ['./gallery.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    MatProgressSpinner,
    MasonryComponent,
    MasonryItemDirective,
    MatCard,
    MatCardHeader,
    MatCardTitle,
    MatCardSubtitle,
    PicsurImgComponent,
    MatCardImage,
    MatCardActions,
    MatButton,
    PaginatorComponent,
    MomentModule,
    TruncatePipe,
  ],
})
export class GalleryComponent implements OnInit {
  private readonly logger = new Logger(GalleryComponent.name);

  images: EGalleryImage[] | null = null;
  columns = 1;

  page = 1;
  pages = 1;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly bootstrapService: BootstrapService,
    private readonly imageService: ImageService,
    private readonly errorService: ErrorService,
  ) {}

  ngOnInit() {
    this.subscribeMobile();
    this.load().catch(this.logger.error);
  }

  private async load() {
    const page = Number(this.route.snapshot.paramMap.get('page') ?? '');
    this.page = isNaN(page) || page <= 0 ? 1 : page;

    const list = await this.imageService.ListGallery(24, this.page - 1);
    if (HasFailed(list)) {
      this.images = [];
      return this.errorService.showFailure(list, this.logger);
    }

    this.pages = list.pages;
    this.images = list.results;
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

  getThumbnailUrl(image: EGalleryImage) {
    return this.imageService.GetThumbnailURL(image.id);
  }

  viewImage(image: EGalleryImage) {
    this.router.navigate(['/view', image.id]);
  }

  gotoPage(page: number) {
    this.router.navigate(['/gallery', page]).then(() => {
      this.load().catch(this.logger.error);
    });
  }
}
