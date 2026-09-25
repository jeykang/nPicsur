import { Controller, Logger, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { FT, Fail, ThrowIfFailed } from 'picsur-shared/dist/types/failable';
import { UsageConfigService } from '../../../config/late/usage.config.service.js';
import { EasyThrottle } from '../../../decorators/easy-throttle.decorator.js';
import { NoPermissions } from '../../../decorators/permissions.decorator.js';
import { ReturnsAnything } from '../../../decorators/returns.decorator.js';

function isJson(contentType: unknown): boolean {
  return (
    typeof contentType === 'string' &&
    contentType.split(';')[0].trim().toLowerCase() === 'application/json'
  );
}

// Passes the visitor statistics of the frontend on to the Ackee server set in
// the tracking_url preference
@Controller('api/usage')
@NoPermissions()
export class UsageController {
  private readonly logger = new Logger(UsageController.name);

  constructor(private readonly usageService: UsageConfigService) {}

  @Post(['report', 'report/*'])
  @ReturnsAnything()
  @EasyThrottle(120)
  async report(
    @Req() req: FastifyRequest,
    @Res({
      passthrough: true,
    })
    res: FastifyReply,
  ) {
    const trackingUrl = ThrowIfFailed(await this.usageService.getTrackingUrl());

    if (trackingUrl === null) {
      throw Fail(FT.NotFound, undefined, 'Tracking URL not set');
    }

    // The tracker only sends JSON. Refusing anything else also keeps other
    // sites from submitting forms here, which the browser would then show as
    // a page from Picsur.
    if (!isJson(req.headers['content-type'])) {
      throw Fail(FT.UsrValidation, 'Only JSON is accepted');
    }

    await res.from(`${trackingUrl.replace(/\/+$/, '')}/api`, {
      rewriteRequestHeaders(request, headers) {
        const req = request as any as FastifyRequest;

        // Credentials are for Picsur, not for the tracking server
        delete headers.cookie;
        delete headers.authorization;

        // Add real ip, this should not work, but ackee uses a bad ip resolver
        // So we might aswell use it
        headers['X-Forwarded-For'] = req.ip;

        return headers;
      },
      // The answer is served as if it came from Picsur, so only what the
      // tracker needs to read it is passed on. Cookies, redirects, or a page
      // the browser would show all stay with the tracking server.
      rewriteHeaders(headers) {
        const kept: Record<string, string | string[]> = {
          'content-type': isJson(headers['content-type'])
            ? String(headers['content-type'])
            : 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
        };
        for (const name of ['content-length', 'content-encoding']) {
          const value = headers[name];
          if (value !== undefined) kept[name] = value;
        }
        return kept;
      },
    });
  }
}
