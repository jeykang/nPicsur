import { describe, expect, it } from 'vitest';
import { Client, expectSuccess } from './helpers/client.js';

describe('info', () => {
  const guest = Client.guest();

  it('reports server info', async () => {
    const info = expectSuccess(await guest.get('/api/info'));
    expect(info.production).toBe(true);
    expect(info.demo).toBe(false);
    const pkg = await import('../../package.json', {
      with: { type: 'json' },
    });
    expect(info.version).toBe(pkg.default.version);
  });

  it('lists all permissions', async () => {
    const data = expectSuccess(await guest.get('/api/info/permissions'));
    expect(data.permissions).toEqual(
      expect.arrayContaining([
        'image-view',
        'image-upload',
        'user-login',
        'syspref-admin',
      ]),
    );
  });

  it('lists supported formats', async () => {
    const data = expectSuccess(await guest.get('/api/info/formats'));
    expect(data.image['image/png']).toBe('png');
    expect(data.image['image/jpeg']).toBe('jpg');
    expect(data.image['image/x-qoi']).toBe('qoi');
    expect(data.anim['image/gif']).toBe('gif');
  });

  it('serves the frontend', async () => {
    const res = await guest.get('/');
    expect(res.status).toBe(200);
    expect(res.body.toString()).toContain('<app-root');
  });

  it('wraps unknown api routes in an error envelope', async () => {
    for (const path of ['/api/does-not-exist', '/api', '/api/image']) {
      const res = await guest.get(path);
      expect(res.status, path).toBe(404);
      expect(res.json.success).toBe(false);
      expect(res.json.data.type).toBe('routenotfound');
    }
    const post = await guest.post('/api/does-not-exist', {});
    expect(post.status).toBe(404);
    expect(post.json.success).toBe(false);
  });

  it('serves the frontend for its own routes', async () => {
    for (const path of ['/upload', '/view/some-id', '/settings/users']) {
      const res = await guest.get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(res.body.toString()).toContain('<app-root');
    }
  });
});
