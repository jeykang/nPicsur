import fastifyStatic from '@fastify/static';
import { Logger } from '@nestjs/common';
import type { FastifyInstance } from 'fastify';
import { createReadStream, existsSync } from 'fs';
import { join } from 'path';
import { ApiErrorResponse } from 'picsur-shared/dist/dto/api/api.dto';
import { Fail, FT } from 'picsur-shared/dist/types/failable';

// Paths that belong to the backend, these never fall back to the frontend
const BackendPrefixes = ['/api/', '/i/'];

const logger = new Logger('Frontend');

// Serves the compiled frontend, and its index.html for every other GET
// request so the Angular router can handle it. Unknown api routes get a
// proper 404 instead of the frontend.
export async function registerFrontend(fastify: FastifyInstance, root: string) {
  const indexFile = join(root, 'index.html');
  if (!existsSync(indexFile)) {
    logger.warn(`No frontend found in ${root}, only serving the api`);
  }

  await fastify.register(fastifyStatic, {
    root,
    // Only serve files that exist at startup, anything else goes to the
    // fallback below
    wildcard: false,
  });

  fastify.get('/*', (request, reply) => {
    const path = request.url.split('?')[0];
    if (path === '/api' || BackendPrefixes.some((p) => path.startsWith(p))) {
      const failure = Fail(FT.RouteNotFound);
      const response: ApiErrorResponse = {
        success: false,
        statusCode: failure.getCode(),
        timestamp: new Date().toISOString(),
        timeMs: Math.round(reply.elapsedTime),
        data: {
          type: failure.getType(),
          message: failure.getReason(),
        },
      };
      return reply.status(failure.getCode()).send(response);
    }

    if (!existsSync(indexFile)) {
      return reply.status(404).send();
    }

    return reply
      .type('text/html')
      .header('Cache-Control', 'no-cache')
      .send(createReadStream(indexFile));
  });
}
