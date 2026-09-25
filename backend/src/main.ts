import fastifyHelmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import fastifyReplyFrom from '@fastify/reply-from';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ParseBool } from 'picsur-shared/dist/util/parse-simple';
import { AppModule } from './app.module.js';
import { EnvPrefix } from './config/config.static.js';
import { HostConfigService } from './config/early/host.config.service.js';
import { ServeStaticConfigService } from './config/early/serve-static.config.service.js';
import { MainExceptionFilter } from './layers/exception/exception.filter.js';
import { registerFrontend } from './layers/http/frontend.js';
import { registerImageHeaders } from './layers/http/image-headers.js';
import { SuccessInterceptor } from './layers/success/success.interceptor.js';
import { PicsurThrottlerGuard } from './layers/throttler/PicsurThrottler.guard.js';
import { ZodValidationPipe } from './layers/validate/zod-validator.pipe.js';
import { PicsurLoggerService } from './logger/logger.service.js';
import { MainAuthGuard } from './managers/auth/guards/main.guard.js';
import { HelmetOptions } from './security.js';

// Which proxies may tell us the real client address (X-Forwarded-For), this
// matters for rate limiting. By default any address in a private range, which
// covers a reverse proxy in the same docker network. PICSUR_TRUST_PROXY can
// be "false", "true" or a comma separated list of addresses and ranges.
function getTrustProxy(): boolean | string[] {
  const value = process.env[`${EnvPrefix}TRUST_PROXY`]?.trim();
  if (!value) {
    return ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];
  }
  const asBool = ParseBool(value, null);
  if (asBool !== null) return asBool;
  return value.split(',').map((entry) => entry.trim());
}

async function bootstrap() {
  const isProduction = ParseBool(process.env[`${EnvPrefix}PRODUCTION`], false);

  // Create fasify
  const fastifyAdapter = new FastifyAdapter({
    trustProxy: getTrustProxy(),
  });
  await fastifyAdapter.register(multipart as any);
  await fastifyAdapter.register(fastifyHelmet as any, HelmetOptions);
  await fastifyAdapter.register(fastifyReplyFrom as any);

  // Create nest app
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    fastifyAdapter,
    {
      bufferLogs: isProduction,
      autoFlushLogs: true,
    },
  );

  // Configure logger
  app.useLogger(app.get(PicsurLoggerService));
  app.flushLogs();

  // Close database connections and the like when stopped
  app.enableShutdownHooks();

  app.useGlobalFilters(app.get(MainExceptionFilter));
  app.useGlobalInterceptors(app.get(SuccessInterceptor));
  app.useGlobalPipes(app.get(ZodValidationPipe));

  app.useGlobalGuards(app.get(PicsurThrottlerGuard), app.get(MainAuthGuard));

  const fastify = app.getHttpAdapter().getInstance();
  registerImageHeaders(fastify);
  await registerFrontend(
    fastify,
    app.get(ServeStaticConfigService).getStaticDirectory(),
  );

  // Start app
  const hostConfigService = app.get(HostConfigService);
  await app.listen(hostConfigService.getPort(), hostConfigService.getHost());
}

bootstrap().catch((e) => {
  console.error(e);
  process.exit(1);
});
