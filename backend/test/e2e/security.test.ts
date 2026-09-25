import { describe, expect, it } from 'vitest';
import { Client } from './helpers/client.js';

describe('security', () => {
  it('rate limits login attempts', async () => {
    // The login route allows 30 attempts per 5 minutes. Spread the attempts
    // out a bit, so a limit that resets too quickly is noticed as well.
    const attacker = Client.pinned();
    const statuses: number[] = [];
    let limitedResponse: any;
    for (let batch = 0; batch < 4; batch++) {
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          attacker.post('/api/user/login', {
            username: 'admin',
            password: `guess-number-${batch}-${i}`,
          }),
        ),
      );
      for (const res of results) {
        statuses.push(res.status);
        if (res.status === 429) limitedResponse = res;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(10);
    expect(limitedResponse.json.data.type).toBe('ratelimit');

    // Other clients are not affected
    const bystander = Client.pinned();
    const res = await bystander.post('/api/user/login', {
      username: 'admin',
      password: 'wrong',
    });
    expect(res.status).not.toBe(429);
  });

  it('does not get in the way of normal use', async () => {
    // Every page load of the frontend asks who is logged in and what they
    // may do, a few people behind one address can do that often
    const admin = await Client.admin();
    admin.pinnedIp = Client.pinned().pinnedIp;
    for (let i = 0; i < 30; i++) {
      const [me, permissions] = await Promise.all([
        admin.get('/api/user/me'),
        admin.get('/api/user/me/permissions'),
      ]);
      expect(me.status).toBe(200);
      expect(permissions.status).toBe(200);
    }
  });

  it('sets security headers', async () => {
    const res = await Client.guest().get('/');
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    // Inline scripts can not run
    expect(csp).toMatch(/script-src 'self'(;|$)/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(res.headers.get('x-powered-by')).toBeNull();
  });

  it('does not allow cross origin api requests', async () => {
    const res = await Client.guest().get('/api/info', {
      headers: { Origin: 'https://evil.example' },
    });
    const allowed = res.headers.get('access-control-allow-origin');
    expect(allowed === null || allowed !== '*').toBe(true);
    expect(allowed).not.toBe('https://evil.example');
  });

  it('does not leak internal error details', async () => {
    const res = await Client.guest().request('POST', '/api/user/login', {
      headers: { 'Content-Type': 'application/json' },
      raw: '{"username": "admin", "password":',
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.json.success).toBe(false);
    expect(res.body.toString()).not.toMatch(/node_modules|at \w+ \(/);
  });
});
