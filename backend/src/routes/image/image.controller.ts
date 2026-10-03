import { Controller, Get, Head, Logger, Query, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';
import {
  ImageMetaResponse,
  ImageRequestParams,
} from 'picsur-shared/dist/dto/api/image.dto';
import { ImageEntryVariant } from 'picsur-shared/dist/dto/image-entry-variant.enum';
import { FileType2Mime } from 'picsur-shared/dist/dto/mimes.dto';
import {
  AsyncFailable,
  FT,
  HasFailed,
  HasSuccess,
  IsFailure,
  ThrowIfFailed,
} from 'picsur-shared/dist/types/failable';
import { UserDbService } from '../../collections/user-db/user-db.service.js';
import { ImageFullIdParam } from '../../decorators/image-id/image-full-id.decorator.js';
import { ImageIdParam } from '../../decorators/image-id/image-id.decorator.js';
import { RequiredPermissions } from '../../decorators/permissions.decorator.js';
import { Returns } from '../../decorators/returns.decorator.js';
import { ImageManagerService } from '../../managers/image/image-manager.service.js';
import type { ImageFullId } from '../../models/constants/image-full-id.const.js';
import { Permission } from '../../models/constants/permissions.const.js';
import { BrandMessageType, GetBrandMessage } from '../../util/branding.js';
import { IsNotModified } from '../../util/not-modified.js';
import { StreamReady } from '../../util/stream-ready.js';

// Images never change, so they can be cached for a month
const MaxAge = 30 * 24 * 60 * 60;

// How long a copy of an image may be used without asking again, and what is
// asked with to find out whether it is still current
interface Validators {
  etag: string;
  lastModified: Date;
  maxAge: number;
  // What HEAD answers with, without converting the image
  mime: string;
}

// This is the only controller with CORS enabled (see image-headers.ts)
@Controller('i')
@RequiredPermissions(Permission.ImageView)
@SkipThrottle()
export class ImageController {
  private readonly logger = new Logger(ImageController.name);

  constructor(
    private readonly imagesService: ImageManagerService,
    private readonly userService: UserDbService,
  ) {}

  @Head(':id')
  async headImage(
    @Res({ passthrough: true }) res: FastifyReply,
    @ImageFullIdParam() fullid: ImageFullId,
    @Query() params: ImageRequestParams,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    const validators = await this.getValidators(fullid, params);
    if (HasFailed(validators)) {
      if (validators.getType() !== FT.NotFound) throw validators;
      await this.notFound(res);
      return;
    }

    this.setValidators(res, validators);
    if (IsNotModified(req.headers, validators.etag, validators.lastModified)) {
      res.status(304);
      return;
    }
    res.type(validators.mime);
  }

  @Get(':id')
  async getImage(
    // Usually passthrough is for manually sending the response,
    // But we need it here to set the mime type
    @Res({ passthrough: true }) res: FastifyReply,
    @ImageFullIdParam() fullid: ImageFullId,
    @Query() params: ImageRequestParams,
    @Req() req: FastifyRequest,
  ): Promise<Buffer | Readable | undefined> {
    try {
      const validators = ThrowIfFailed(
        await this.getValidators(fullid, params),
      );
      if (
        IsNotModified(req.headers, validators.etag, validators.lastModified)
      ) {
        this.setValidators(res, validators);
        res.status(304);
        return;
      }

      const image = ThrowIfFailed(
        fullid.variant === ImageEntryVariant.ORIGINAL
          ? await this.imagesService.getOriginal(fullid.id)
          : await this.imagesService.getConverted(
              fullid.id,
              fullid.filetype,
              params,
              req.ip,
            ),
      );

      const mime = FileType2Mime(image.filetype);
      if (HasFailed(mime)) {
        if (image.data instanceof Readable) image.data.destroy();
        throw mime;
      }
      // So that a failure to read it is not answered with its headers
      if (image.data instanceof Readable) {
        ThrowIfFailed(await StreamReady(image.data));
      }

      // Only once it is there, failures must not be cached
      this.setValidators(res, validators);
      res.type(mime);
      if (image.data instanceof Readable && image.size !== null) {
        res.header('Content-Length', image.size);
      }
      return image.data;
    } catch (e) {
      if (!IsFailure(e) || e.getType() !== FT.NotFound) throw e;
      return this.notFound(res);
    }
  }

  @Get('meta/:id')
  @Returns(ImageMetaResponse)
  async getImageMeta(@ImageIdParam() id: string): Promise<ImageMetaResponse> {
    const image = ThrowIfFailed(await this.imagesService.findOne(id));

    const [fileMimesRes, imageUserRes] = await Promise.all([
      this.imagesService.getFileMimes(id),
      this.userService.findOne(image.user_id),
    ]);

    const fileTypes = ThrowIfFailed(fileMimesRes);
    // Picsur 0.5 kept the images of users it deleted
    let user: ImageMetaResponse['user'] = null;
    if (HasSuccess(imageUserRes)) {
      user = { id: imageUserRes.id, username: imageUserRes.username };
    } else if (imageUserRes.getType() !== FT.NotFound) {
      throw imageUserRes;
    }

    return { image, user, fileTypes };
  }

  // Fails with NotFound for images, and originals, that do not exist
  private async getValidators(
    fullid: ImageFullId,
    params: ImageRequestParams,
  ): AsyncFailable<Validators> {
    const image = await this.imagesService.findOne(fullid.id);
    if (HasFailed(image)) return image;

    const common = {
      lastModified: image.created,
      maxAge: MaxAgeUntil(image.expires_at),
    };

    if (fullid.variant === ImageEntryVariant.ORIGINAL) {
      const filetype = await this.imagesService.getOriginalFileType(fullid.id);
      if (HasFailed(filetype)) return filetype;
      const mime = FileType2Mime(filetype.identifier);
      if (HasFailed(mime)) return mime;
      // Kept exactly as it was uploaded
      return { ...common, mime, etag: `"${image.id}-original"` };
    }

    const mime = FileType2Mime(fullid.filetype);
    if (HasFailed(mime)) return mime;
    // Converted versions are made again when they were not asked for in a
    // while, maybe by a newer Picsur, so the same image can come out as other
    // bytes. The tag is weak for that.
    const key = this.imagesService.getConvertKey(fullid.filetype, params);
    return { ...common, mime, etag: `W/"${image.id}-${key.slice(0, 16)}"` };
  }

  private setValidators(res: FastifyReply, validators: Validators) {
    res.header('Cache-Control', `public, max-age=${validators.maxAge}`);
    res.header('ETag', validators.etag);
    res.header('Last-Modified', validators.lastModified.toUTCString());
  }

  // Still an image, so embeds show something, but one that must not be
  // cached as if it was the real thing
  private async notFound(res: FastifyReply): Promise<Buffer> {
    const message = ThrowIfFailed(
      await GetBrandMessage(BrandMessageType.NotFound),
    );
    res.status(404);
    res.header('Cache-Control', 'no-store');
    res.type(message.type);
    return message.data;
  }
}

// A month, or until the image expires when that is sooner
function MaxAgeUntil(expiresAt: Date | null): number {
  if (expiresAt === null) return MaxAge;
  const left = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
  return Math.min(MaxAge, Math.max(0, left));
}
