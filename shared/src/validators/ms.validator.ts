import ms from 'ms';
import { z } from 'zod';

// A duration like "7d" or "15s", validated as its value in milliseconds
export const IsValidMS = (min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z.preprocess(
    (v: any) => {
      try {
        return ms(v);
      } catch (e) {
        return NaN;
      }
    },
    z
      .number({
        errorMap: () => ({
          message: 'Invalid duration value',
        }),
      })
      .int()
      .min(min)
      .max(max),
  );
