import { z } from 'zod';
import { IsEntityID } from '../validators/entity-id.validator.js';

export const IsAlbumName = () => z.string().trim().min(1).max(100);

// A collection of images of one user. Like images, anyone who has its link
// can see it.
export const EAlbumSchema = z.object({
  id: IsEntityID(),
  user_id: IsEntityID(),
  name: IsAlbumName(),
  created: z.preprocess((data: any) => new Date(data), z.date()),
});
export type EAlbum = z.infer<typeof EAlbumSchema>;
