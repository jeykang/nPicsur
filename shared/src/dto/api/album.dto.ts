import { z } from 'zod';
import { EAlbumSchema, IsAlbumName } from '../../entities/album.entity.js';
import { EImageSchema } from '../../entities/image.entity.js';
import { EPublicUserSchema } from '../../entities/user.entity.js';
import { createZodDto } from '../../util/create-zod-dto.js';
import { IsEntityID } from '../../validators/entity-id.validator.js';
import { IsPosInt } from '../../validators/positive-int.validator.js';

// An album with how many images it has, and the one added last to show as
// its cover
export const EAlbumSummarySchema = EAlbumSchema.extend({
  image_count: IsPosInt(),
  cover_id: IsEntityID().nullable(),
  // Only when asked about a specific image
  contains_image: z.boolean().optional(),
});
export type EAlbumSummary = z.infer<typeof EAlbumSummarySchema>;

// AlbumCreate
export const AlbumCreateRequestSchema = z.object({
  name: IsAlbumName(),
});
export class AlbumCreateRequest extends createZodDto(
  AlbumCreateRequestSchema,
) {}

export const AlbumCreateResponseSchema = EAlbumSummarySchema;
export class AlbumCreateResponse extends createZodDto(
  AlbumCreateResponseSchema,
) {}

// AlbumList, of your own albums, or of any user for image admins
export const AlbumListRequestSchema = z.object({
  count: IsPosInt(),
  page: IsPosInt(),
  user_id: IsEntityID().optional(),
  // Tells for each album whether this image is in it
  image_id: IsEntityID().optional(),
});
export class AlbumListRequest extends createZodDto(AlbumListRequestSchema) {}

export const AlbumListResponseSchema = z.object({
  results: z.array(EAlbumSummarySchema),
  total: IsPosInt(),
  page: IsPosInt(),
  pages: IsPosInt(),
});
export class AlbumListResponse extends createZodDto(AlbumListResponseSchema) {}

// AlbumInfo
export const AlbumInfoRequestSchema = z.object({
  id: IsEntityID(),
});
export class AlbumInfoRequest extends createZodDto(AlbumInfoRequestSchema) {}

export const AlbumInfoResponseSchema = z.object({
  album: EAlbumSummarySchema,
  user: EPublicUserSchema,
});
export class AlbumInfoResponse extends createZodDto(AlbumInfoResponseSchema) {}

// AlbumImages, the images added last first
export const AlbumImagesRequestSchema = z.object({
  id: IsEntityID(),
  count: IsPosInt(),
  page: IsPosInt(),
});
export class AlbumImagesRequest extends createZodDto(
  AlbumImagesRequestSchema,
) {}

export const AlbumImagesResponseSchema = z.object({
  results: z.array(EImageSchema),
  total: IsPosInt(),
  page: IsPosInt(),
  pages: IsPosInt(),
});
export class AlbumImagesResponse extends createZodDto(
  AlbumImagesResponseSchema,
) {}

// AlbumUpdate
export const AlbumUpdateRequestSchema = z.object({
  id: IsEntityID(),
  name: IsAlbumName(),
});
export class AlbumUpdateRequest extends createZodDto(
  AlbumUpdateRequestSchema,
) {}

export const AlbumUpdateResponseSchema = EAlbumSummarySchema;
export class AlbumUpdateResponse extends createZodDto(
  AlbumUpdateResponseSchema,
) {}

// AlbumDelete, the images in it stay
export const AlbumDeleteRequestSchema = z.object({
  id: IsEntityID(),
});
export class AlbumDeleteRequest extends createZodDto(
  AlbumDeleteRequestSchema,
) {}

export const AlbumDeleteResponseSchema = EAlbumSchema;
export class AlbumDeleteResponse extends createZodDto(
  AlbumDeleteResponseSchema,
) {}

// AlbumAddImages and AlbumRemoveImages, only images of the album's owner can
// be added
export const AlbumChangeImagesRequestSchema = z.object({
  id: IsEntityID(),
  image_ids: z.array(IsEntityID()).min(1).max(100),
});
export class AlbumChangeImagesRequest extends createZodDto(
  AlbumChangeImagesRequestSchema,
) {}

export const AlbumChangeImagesResponseSchema = EAlbumSummarySchema;
export class AlbumChangeImagesResponse extends createZodDto(
  AlbumChangeImagesResponseSchema,
) {}
