import { z } from 'zod';

// Seconds until an image expires, 0 for never, at most ten years
export const IsExpiry = () =>
  z
    .number()
    .int()
    .min(0)
    .max(10 * 365 * 24 * 60 * 60);
