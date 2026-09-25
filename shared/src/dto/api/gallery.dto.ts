import { z } from 'zod';
import { EImageSchema } from '../../entities/image.entity.js';
import { EPublicUserSchema } from '../../entities/user.entity.js';
import { createZodDto } from '../../util/create-zod-dto.js';
import { IsPosInt } from '../../validators/positive-int.validator.js';

// The images their owners chose to show in the gallery, newest first
export const GalleryListRequestSchema = z.object({
  count: IsPosInt(),
  page: IsPosInt(),
});
export class GalleryListRequest extends createZodDto(
  GalleryListRequestSchema,
) {}

export const EGalleryImageSchema = EImageSchema.extend({
  // Null when the user who uploaded it no longer exists
  user: EPublicUserSchema.nullable(),
});
export type EGalleryImage = z.infer<typeof EGalleryImageSchema>;

export const GalleryListResponseSchema = z.object({
  results: z.array(EGalleryImageSchema),
  total: IsPosInt(),
  page: IsPosInt(),
  pages: IsPosInt(),
});
export class GalleryListResponse extends createZodDto(
  GalleryListResponseSchema,
) {}
