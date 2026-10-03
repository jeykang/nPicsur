import { z } from 'zod';
import { EImageSchema } from '../../entities/image.entity.js';
import { createZodDto } from '../../util/create-zod-dto.js';
import { IsApiKey } from '../../validators/api-key.validator.js';
import { IsExpiry } from '../../validators/expiry.validator.js';
import { IsEntityID } from '../../validators/entity-id.validator.js';
import { IsPosInt } from '../../validators/positive-int.validator.js';
import { SupportedFileTypes } from '../mimes.dto.js';

// Whole seconds in a query, only digits. Empty is the same as not given.
const ParseSeconds = (value: unknown) => {
  if (value === '') return undefined;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return value;
};

// Image upload, optionally with when it expires: in this many seconds, or
// never with 0. Otherwise the uploader's default applies.
export const ImageUploadQuerySchema = z.object({
  expires_after: z.preprocess(ParseSeconds, IsExpiry().optional()),
});
export class ImageUploadQuery extends createZodDto(ImageUploadQuerySchema) {}

export const ImageUploadResponseSchema = EImageSchema.extend({
  delete_key: IsApiKey().optional(),
});
export class ImageUploadResponse extends createZodDto(
  ImageUploadResponseSchema,
) {}

// Image list, of your own images, or of any user for image admins. Only the
// images that match every filter that is given.

// A date and time with its offset, like 2026-10-03T12:00:00Z. The frontend
// gives a Date, which is sent like that.
const IsDate = () =>
  z.preprocess(
    (value) =>
      value instanceof Date && !isNaN(value.getTime())
        ? value.toISOString()
        : value,
    z
      .string()
      .datetime({ offset: true })
      .transform((value) => new Date(value)),
  );

export const ImageListFiltersSchema = z.object({
  // Part of the name, in upper or lower case
  search: z.string().trim().min(1).max(100).optional(),
  // How the image is stored, like image:png
  filetypes: z
    .array(
      z.string().refine((type) => SupportedFileTypes.includes(type), {
        message: 'Unknown file type',
      }),
    )
    .min(1)
    .max(20)
    .optional(),
  album_id: IsEntityID().optional(),
  // Uploaded at or after, and before
  uploaded_after: IsDate().optional(),
  uploaded_before: IsDate().optional(),
});
export type ImageListFilters = z.infer<typeof ImageListFiltersSchema>;

export const ImageListRequestSchema = ImageListFiltersSchema.extend({
  count: IsPosInt(),
  page: IsPosInt(),
  user_id: IsEntityID().optional(),
});
export class ImageListRequest extends createZodDto(ImageListRequestSchema) {}

export const ImageListResponseSchema = z.object({
  results: z.array(EImageSchema),
  total: IsPosInt(),
  page: IsPosInt(),
  pages: IsPosInt(),
});
export class ImageListResponse extends createZodDto(ImageListResponseSchema) {}

// Image update
export const ImageUpdateRequestSchema = EImageSchema.pick({
  id: true,
  expires_at: true,
  file_name: true,
  listed: true,
}).partial({
  expires_at: true,
  file_name: true,
  listed: true,
});
export class ImageUpdateRequest extends createZodDto(
  ImageUpdateRequestSchema,
) {}

export const ImageUpdateResponseSchema = EImageSchema;
export class ImageUpdateResponse extends createZodDto(
  ImageUpdateResponseSchema,
) {}

// Image Delete

export const ImageDeleteRequestSchema = z.object({
  ids: z.array(IsEntityID()),
});
export class ImageDeleteRequest extends createZodDto(
  ImageDeleteRequestSchema,
) {}

export const ImageDeleteResponseSchema = z.object({
  images: z.array(EImageSchema),
});
export class ImageDeleteResponse extends createZodDto(
  ImageDeleteResponseSchema,
) {}

// Image Delete with Key
export const ImageDeleteWithKeyRequestSchema = z.object({
  id: IsEntityID(),
  key: IsApiKey(),
});
export class ImageDeleteWithKeyRequest extends createZodDto(
  ImageDeleteWithKeyRequestSchema,
) {}

export const ImageDeleteWithKeyResponseSchema = EImageSchema;
export class ImageDeleteWithKeyResponse extends createZodDto(
  ImageDeleteWithKeyResponseSchema,
) {}
