import fastifyHelmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import fastifyReplyFrom from '@fastify/reply-from';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ServerSetting } from 'picsur-shared/dist/dto/server-settings.dto';
import { ParseBool } from 'picsur-shared/dist/util/parse-simple';
import { AppModule } from './app.module.js';
import { EnvPrefix } from './config/config.static.js';
import { HostConfigService } from './config/early/host.config.service.js';
import { ServeStaticConfigService } from './config/early/serve-static.config.service.js';
import {
  DefaultTrustProxy,
  GetServerSetting,
  LoadStoredServerSettings,
  SaveStoredServerSettings,
  StoredServerSettings,
  UseStoredServerSettings,
} from './config/server-settings.js';
import { MainExceptionFilter } from './layers/exception/exception.filter.js';
import { registerFrontend } from './layers/http/frontend.js';
import { registerImageHeaders } from './layers/http/image-headers.js';
import { SuccessInterceptor } from './layers/success/success.interceptor.js';
import { PicsurThrottlerGuard } from './layers/throttler/PicsurThrottler.guard.js';
import { ZodValidationPipe } from './layers/validate/zod-validator.pipe.js';
import { PicsurLoggerService } from './logger/logger.service.js';
import { MainAuthGuard } from './managers/auth/guards/main.guard.js';
import { HelmetOptions } from './security.js';
import { CollectGarbageWhenIdle, NoteActivity } from './util/idle-gc.js';
import {
  MarkStarted,
  SetRestartError,
  WaitForRestart,
} from './util/restart.js';

// Which proxies may tell us the real client address (X-Forwarded-For), this
// matters for rate limiting. Can be "false", "true" or a comma separated list
// of addresses and ranges.
function getTrustProxy(): boolean | string[] {
  const value = GetServerSetting(ServerSetting.TrustProxy);
  if (!value) return [...DefaultTrustProxy];
  const asBool = ParseBool(value, null);
  if (asBool !== null) return asBool;
  return value.split(',').map((entry) => entry.trim());
}

async function bootstrap(
  settings: StoredServerSettings,
): Promise<NestFastifyApplication> {
  UseStoredServerSettings(settings);
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
      // Throw instead of exiting, so a restart with new settings that do not
      // work can go back to the previous ones
      abortOnError: false,
    },
  );

  try {
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
    // Memory is only given back while no requests come in
    fastify.addHook('onRequest', (_request, _reply, done) => {
      NoteActivity();
      done();
    });
    fastify.addHook('onResponse', (_request, _reply, done) => {
      NoteActivity();
      done();
    });
    registerImageHeaders(fastify);
    await registerFrontend(
      fastify,
      app.get(ServeStaticConfigService).getStaticDirectory(),
    );

    // Start app
    const hostConfigService = app.get(HostConfigService);
    await app.listen(hostConfigService.getPort(), hostConfigService.getHost());
  } catch (e) {
    await app.close().catch(() => undefined);
    throw e;
  }

  MarkStarted();
  return app;
}

// Lets requests in progress finish, but not forever
async function shutdown(app: NestFastifyApplication) {
  const server = app.getHttpServer();
  const force = setTimeout(() => server.closeAllConnections(), 10_000);
  try {
    await app.close();
  } finally {
    clearTimeout(force);
  }
}

// Starts Picsur, and starts it again with the stored settings whenever that
// is asked for on the settings page
async function main() {
  const logger = new Logger('Picsur');
  CollectGarbageWhenIdle();

  let settings = await LoadStoredServerSettings();
  let app = await bootstrap(settings);

  for (;;) {
    await WaitForRestart();
    logger.log('Restarting to apply the server settings');
    await shutdown(app);

    const previous = settings;
    try {
      settings = await LoadStoredServerSettings();
      app = await bootstrap(settings);
      SetRestartError(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error(
        `Could not start with the new server settings, going back to the previous ones: ${message}`,
      );
      settings = previous;
      await SaveStoredServerSettings(previous).catch((saveError) =>
        logger.error(`Could not store the previous settings: ${saveError}`),
      );
      app = await bootstrap(previous);
      SetRestartError(message);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
