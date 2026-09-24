import { describe, expect, it } from 'vitest';
import { Client, expectSuccess } from './helpers/client.js';

describe('info', () => {
  const guest = Client.guest();

  it('reports server info', async () => {
    const info = expectSuccess(await guest.get('/api/info'));
    expect(info.production).toBe(true);
    expect(info.demo).toBe(false);
    expect(info.version).toMatch(/^\d+\.\d+\.\d+$/);
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
    expect(res.body.toString()).toContain('picsur-e2e');
  });

  // Unknown GET routes currently fall through to the frontend's index.html,
  // @nestjs/serve-static 4 can't exclude paths when running on fastify
  it.fails('wraps unknown api routes in an error envelope', async () => {
    const res = await guest.get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.json.success).toBe(false);
  });
});
