import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { HasFailed } from 'picsur-shared/dist/types/failable';
import { ImageService } from '../../services/api/image.service';
import { Logger } from '../../services/logger/logger.service';

// Where deletion links lead. Deleting takes a click, because chat apps and
// browsers open links on their own to show a preview, which should not delete
// the image.
@Component({
  templateUrl: './delete.component.html',
  styleUrls: ['./delete.component.scss'],
})
export class DeleteComponent implements OnInit {
  private readonly logger = new Logger(DeleteComponent.name);

  public id = '';
  private key = '';
  public busy = false;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly imageService: ImageService,
  ) {}

  ngOnInit() {
    const params = this.route.snapshot.paramMap;
    this.id = params.get('id') ?? '';
    this.key = params.get('key') ?? '';
  }

  get previewUrl() {
    return `/i/${encodeURIComponent(this.id)}.jpg?width=512&shrinkonly=yes`;
  }

  async delete() {
    this.busy = true;
    const result = await this.imageService.DeleteImageWithKey(
      this.id,
      this.key,
    );
    if (HasFailed(result)) {
      result.print(this.logger);
      this.router.navigate(['/error/delete-failure'], { replaceUrl: true });
    } else {
      this.router.navigate(['/error/delete-success'], { replaceUrl: true });
    }
  }

  keep() {
    this.router.navigate(['/view', this.id], { replaceUrl: true });
  }
}
