import Fastify from 'fastify';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { StripBasePath } from '../../src/config/base-path.js';
import { registerFrontend } from '../../src/layers/http/frontend.js';

describe.each(['', '/picsur', '/apps/picsur'])('frontend at %s', (base) => {
  it('serves pages, assets and API routes with either proxy style', async () => {
    const root = await mkdtemp(join(tmpdir(), 'picsur-frontend-'));
    const app = Fastify({
      rewriteUrl: (req) => StripBasePath(req.url ?? '/', base),
    });
    try {
      await mkdir(join(root, 'assets'));
      await writeFile(
        join(root, 'index.html'),
        '<html><head><base href="/" /></head><body><script src="main.js"></script></body></html>',
      );
      await writeFile(join(root, 'main.js'), 'console.log("loaded");');
      await writeFile(join(root, 'assets/theme.js'), 'console.log("theme");');
      app.get('/api/info', async () => ({ success: true }));
      await registerFrontend(app, root, base);
      await app.ready();

      // One proxy preserves the mount path; the other strips it before
      // forwarding. Both must return a page that uses the public base path.
      for (const prefix of new Set(['', base])) {
        for (const path of ['/', '/index.html', '/user/login?local']) {
          const page = await app.inject(`${prefix}${path}`);
          expect(page.statusCode).toBe(200);
          expect(page.headers['content-type']).toContain('text/html');
          expect(page.body).toContain(`<base href="${base}/"`);
          expect(page.headers['cache-control']).toBe('no-cache');
        }
        for (const path of ['/main.js', '/assets/theme.js']) {
          const asset = await app.inject(`${prefix}${path}`);
          expect(asset.statusCode).toBe(200);
          expect(asset.headers['content-type']).toContain('javascript');
          expect(asset.body).toContain('console.log');
        }
        const info = await app.inject(`${prefix}/api/info`);
        expect(info.json()).toEqual({ success: true });
        for (const path of ['/api/missing', '/i/missing']) {
          const missing = await app.inject(`${prefix}${path}`);
          expect(missing.statusCode).toBe(404);
          expect(missing.json().data.type).toBe('routenotfound');
        }
        const head = await app.inject({ method: 'HEAD', url: `${prefix}/` });
        expect(head.statusCode).toBe(200);
        expect(head.headers['content-type']).toContain('text/html');
        expect(head.body).toBe('');
      }
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
