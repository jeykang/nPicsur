import { z } from 'zod';

// An absolute http(s) url
export const IsHttpUrl = () =>
  z
    .string()
    .max(2048)
    .refine((value) => {
      try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    }, 'Invalid url, it should start with http:// or https://');
