import { Module } from '@nestjs/common';
import { seconds, ThrottlerModule } from '@nestjs/throttler';
import { MainExceptionFilter } from './exception/exception.filter.js';
import { SuccessInterceptor } from './success/success.interceptor.js';
import { PicsurThrottlerGuard } from './throttler/PicsurThrottler.guard.js';
import { ZodValidationPipe } from './validate/zod-validator.pipe.js';

@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [
        // Per visitor address. Loading a page of the frontend alone makes a
        // handful of requests, and several people can share one address.
        // Routes that need a tighter limit, like logging in, set their own.
        {
          limit: 300,
          ttl: seconds(60),
        },
      ],
    }),
  ],
  providers: [
    PicsurThrottlerGuard,
    MainExceptionFilter,
    SuccessInterceptor,
    ZodValidationPipe,
  ],
  exports: [
    PicsurThrottlerGuard,
    MainExceptionFilter,
    SuccessInterceptor,
    ZodValidationPipe,
  ],
})
export class PicsurLayersModule {}
