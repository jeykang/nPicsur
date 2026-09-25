import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  ImageDeleteRequest,
  ImageDeleteResponse,
  ImageDeleteWithKeyRequest,
  ImageDeleteWithKeyResponse,
  ImageListRequest,
  ImageListResponse,
  ImageUpdateRequest,
  ImageUpdateResponse,
  ImageUploadResponse,
} from 'picsur-shared/dist/dto/api/image-manage.dto';
import { Permission } from 'picsur-shared/dist/dto/permissions.enum';
import { FT, Fail, ThrowIfFailed } from 'picsur-shared/dist/types/failable';
import { EasyThrottle } from '../../decorators/easy-throttle.decorator.js';
import { PostFiles } from '../../decorators/multipart/multipart.decorator.js';
import type { FileIterator } from '../../decorators/multipart/postfiles.pipe.js';
import {
  HasPermission,
  RequiredPermissions,
} from '../../decorators/permissions.decorator.js';
import { ReqUserID } from '../../decorators/request-user.decorator.js';
import { Returns } from '../../decorators/returns.decorator.js';
import { ImageManagerService } from '../../managers/image/image.service.js';
import { GetNextAsync } from '../../util/iterator.js';

@Controller('api/image')
@RequiredPermissions(Permission.ImageUpload)
export class ImageManageController {
  private readonly logger = new Logger(ImageManageController.name);

  constructor(private readonly imagesService: ImageManagerService) {}

  @Post('upload')
  @Returns(ImageUploadResponse)
  @EasyThrottle(20)
  async uploadImage(
    @PostFiles(1) multipart: FileIterator,
    @ReqUserID() userid: string,
    @HasPermission(Permission.ImageDeleteKey) withDeleteKey: boolean,
  ): Promise<ImageUploadResponse> {
    const file = ThrowIfFailed(await GetNextAsync(multipart));

    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch (e: any) {
      // E.g. the file is larger than the configured maximum
      if (e?.statusCode >= 400 && e?.statusCode < 500) {
        throw Fail(FT.BadRequest, e.message, e);
      }
      throw Fail(FT.Internal, e);
    }

    const image = ThrowIfFailed(
      await this.imagesService.upload(
        userid,
        file.filename,
        buffer,
        withDeleteKey,
      ),
    );

    return image;
  }

  @Post('list')
  @RequiredPermissions(Permission.ImageManage)
  @Returns(ImageListResponse)
  async listMyImagesPaged(
    @Body() body: ImageListRequest,
    @ReqUserID() userid: string,
    @HasPermission(Permission.ImageAdmin) isImageAdmin: boolean,
  ): Promise<ImageListResponse> {
    if (!isImageAdmin) {
      body.user_id = userid;
    }

    const found = ThrowIfFailed(
      await this.imagesService.findMany(body.count, body.page, body.user_id),
    );

    return found;
  }

  @Post('update')
  @RequiredPermissions(Permission.ImageManage)
  @Returns(ImageUpdateResponse)
  async updateImage(
    @Body() body: ImageUpdateRequest,
    @ReqUserID() userid: string,
    @HasPermission(Permission.ImageAdmin) isImageAdmin: boolean,
  ): Promise<ImageUpdateResponse> {
    const user_id = isImageAdmin ? undefined : userid;

    const image = ThrowIfFailed(
      await this.imagesService.update(body.id, user_id, body),
    );

    return image;
  }

  @Post('delete')
  @RequiredPermissions(Permission.ImageManage)
  @Returns(ImageDeleteResponse)
  async deleteImage(
    @Body() body: ImageDeleteRequest,
    @ReqUserID() userid: string,
    @HasPermission(Permission.ImageAdmin) isImageAdmin: boolean,
  ): Promise<ImageDeleteResponse> {
    const deletedImages = ThrowIfFailed(
      await this.imagesService.deleteMany(
        body.ids,
        isImageAdmin ? undefined : userid,
      ),
    );

    return {
      images: deletedImages,
    };
  }

  @Post('delete/key')
  @RequiredPermissions(Permission.ImageDeleteKey)
  @Returns(ImageDeleteWithKeyResponse)
  async deleteImageWithKey(
    @Body() body: ImageDeleteWithKeyRequest,
  ): Promise<ImageDeleteWithKeyResponse> {
    return ThrowIfFailed(
      await this.imagesService.deleteWithKey(body.id, body.key),
    );
  }

  // Deletion links, as handed out to ShareX, lead to a page that asks to
  // confirm. Chat apps and browsers open links by themselves to show a
  // preview, which deleted the image as soon as its link was shared.
  @Get('delete/:id/:key')
  @RequiredPermissions(Permission.ImageDeleteKey)
  async confirmDeleteImageWithKey(
    @Param() params: ImageDeleteWithKeyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<string> {
    // Both are validated, an uuid and 32 letters or digits
    res.header('Location', `/delete/${params.id}/${params.key}`);
    res.code(302);
    return 'Confirm deleting the image';
  }
}
