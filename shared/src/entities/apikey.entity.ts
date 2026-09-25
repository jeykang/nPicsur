import { z } from 'zod';
import { IsEntityID } from '../validators/entity-id.validator.js';

export const EApiKeySchema = z.object({
  id: IsEntityID(),
  // The last characters of the key, to tell keys apart. The key itself is
  // only stored as a hash, and shown once when it is created.
  key_hint: z.string(),
  user: IsEntityID(),
  name: z.string().max(255),
  created: z.preprocess((data: any) => new Date(data), z.date()),
  last_used: z.preprocess((data: any) => new Date(data), z.date()).nullable(),
});
export type EApiKey = z.infer<typeof EApiKeySchema>;
