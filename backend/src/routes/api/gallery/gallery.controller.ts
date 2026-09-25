import { Body, Controller, Post } from '@nestjs/common';
import {
  GalleryListRequest,
  GalleryListResponse,
} from 'picsur-shared/dist/dto/api/gallery.dto';
import { ThrowIfFailed } from 'picsur-shared/dist/types/failable';
import { ImageDBService } from '../../../collections/image-db/image-db.service.js';
import { RequiredPermissions } from '../../../decorators/permissions.decorator.js';
import { Returns } from '../../../decorators/returns.decorator.js';
import { Permission } from '../../../models/constants/permissions.const.js';

@Controller('api/gallery')
@RequiredPermissions(Permission.GalleryView)
export class GalleryController {
  constructor(private readonly imageDB: ImageDBService) {}

  @Post('list')
  @Returns(GalleryListResponse)
  async list(@Body() body: GalleryListRequest): Promise<GalleryListResponse> {
    return ThrowIfFailed(await this.imageDB.findGallery(body.count, body.page));
  }
}
