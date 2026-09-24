import type { FastifyInstance } from 'fastify';

const ImagePrefix = '/i/';

// Images are meant to be embedded anywhere, so unlike the rest of the api
// they may be used cross origin
export function registerImageHeaders(fastify: FastifyInstance) {
  fastify.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith(ImagePrefix)) return;

    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Expose-Headers', 'Content-Type');
    // Overrides the same-origin policy set by helmet
    reply.header('Cross-Origin-Resource-Policy', 'cross-origin');

    if (request.method === 'OPTIONS') {
      reply.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      reply.header(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, Accept',
      );
      reply.header('Access-Control-Max-Age', String(30 * 24 * 60 * 60));
      return reply.code(204).send();
    }
  });
}
