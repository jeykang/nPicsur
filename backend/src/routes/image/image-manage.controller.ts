import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Query,
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
  ImageUploadQuery,
  ImageUploadResponse,
} from 'picsur-shared/dist/dto/api/image-manage.dto';
import { Permission } from 'picsur-shared/dist/dto/permissions.enum';
import type { EUser } from 'picsur-shared/dist/entities/user.entity';
import { FT, Fail, ThrowIfFailed } from 'picsur-shared/dist/types/failable';
import { EasyThrottle } from '../../decorators/easy-throttle.decorator.js';
import { PostFiles } from '../../decorators/multipart/multipart.decorator.js';
import type { FileIterator } from '../../decorators/multipart/multipart.pipe.js';
import {
  HasPermission,
  RequiredPermissions,
} from '../../decorators/permissions.decorator.js';
import { ReqUser, ReqUserID } from '../../decorators/request-user.decorator.js';
import { Returns } from '../../decorators/returns.decorator.js';
import { ImageManagerService } from '../../managers/image/image-manager.service.js';
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
    @Query() query: ImageUploadQuery,
    @ReqUser() user: EUser,
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
        user.id,
        file.filename,
        buffer,
        withDeleteKey,
        query.expires_after,
        // Visitors who are not logged in are the guest user
        user.username === 'guest',
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

    const { count, page, user_id, ...filters } = body;
    const found = ThrowIfFailed(
      await this.imagesService.findMany(count, page, user_id, filters),
    );

    return found;
  }

  @Post('update')
  @RequiredPermissions(Permission.ImageManage)
  @Returns(ImageUpdateResponse)
  async updateImage(
    @Body() body: ImageUpdateRequest,
    @ReqUser() user: EUser,
    @HasPermission(Permission.ImageAdmin) isImageAdmin: boolean,
  ): Promise<ImageUpdateResponse> {
    const user_id = isImageAdmin ? undefined : user.id;

    const image = ThrowIfFailed(
      await this.imagesService.update(
        body.id,
        user_id,
        body,
        user.username === 'guest',
      ),
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
