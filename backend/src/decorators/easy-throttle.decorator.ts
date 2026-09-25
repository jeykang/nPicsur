import { seconds, Throttle } from '@nestjs/throttler';

// Allow `limit` requests per `ttl` seconds
export const EasyThrottle = (
  limit: number,
  ttl = 60,
): MethodDecorator & ClassDecorator =>
  Throttle({
    default: {
      limit,
      // The throttler works in milliseconds
      ttl: seconds(ttl),
    },
  });
