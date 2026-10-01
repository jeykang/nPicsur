import { randomUUID } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, expectFailure, expectSuccess } from './helpers/client.js';
import { update } from './helpers/settings.js';

// The frontend reports visitor statistics through /api/usage/report, which
// passes them on to the Ackee server in the tracking_url setting. Here a
// stand-in plays a tracking server that answers the way a hostile one would.
describe('usage statistics', () => {
  let admin: Client;
  let server: Server;
  let requests: { headers: IncomingHttpHeaders; body: string }[] = [];
  let answer: { type: string; body: string };
  const trackingId = randomUUID();

  beforeAll(async () => {
    admin = await Client.admin();

    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        requests.push({ headers: req.headers, body });
        res.writeHead(200, {
          'Content-Type': answer.type,
          'Set-Cookie': 'session=stolen',
          'Access-Control-Allow-Origin': '*',
          'X-Tracker': 'yes',
        });
        res.end(answer.body);
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as AddressInfo;

    const saved = expectSuccess(
      await update(admin, {
        tracking_url: `http://127.0.0.1:${port}/`,
        tracking_id: trackingId,
      }),
    );
    // Takes effect without restarting
    expect(saved.restart_needed).toBe(false);
  });

  afterAll(async () => {
    await update(admin, { tracking_url: null, tracking_id: null });
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    requests = [];
    answer = {
      type: 'application/json; charset=utf-8',
      body: '{"data":{"createRecord":{"payload":{"id":"x"}}}}',
    };
  });

  it('passes reports on to the tracking server', async () => {
    const res = await admin.post('/api/usage/report/api', {
      query: 'mutation',
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(
      'application/json; charset=utf-8',
    );
    expect(res.json).toEqual(JSON.parse(answer.body));

    expect(requests).toHaveLength(1);
    expect(JSON.parse(requests[0].body)).toEqual({ query: 'mutation' });
    // The visitor's credentials are not passed on
    expect(requests[0].headers['authorization']).toBeUndefined();
    expect(requests[0].headers['cookie']).toBeUndefined();
  });

  it('does not serve pages or cookies from the tracking server', async () => {
    answer = {
      type: 'text/html',
      body: '<script>alert(localStorage.apiKey)</script>',
    };
    const res = await Client.guest().post('/api/usage/report', {});
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.headers.get('x-tracker')).toBeNull();
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.body.toString()).toBe(answer.body);
  });

  it('tells the frontend to count visits', async () => {
    const info = expectSuccess(await Client.guest().get('/api/info'));
    expect(info.tracking.id).toBe(trackingId);
  });

  it('needs both the server and the website id', async () => {
    expectSuccess(await update(admin, { tracking_id: null }));
    try {
      const info = expectSuccess(await Client.guest().get('/api/info'));
      expect(info.tracking.id).toBeUndefined();
      expectFailure(await Client.guest().post('/api/usage/report', {}), 404);
      expect(requests).toHaveLength(0);
    } finally {
      expectSuccess(await update(admin, { tracking_id: trackingId }));
    }
  });

  it('refuses anything but JSON', async () => {
    // Like a form another site submits
    const res = await Client.guest().request('POST', '/api/usage/report', {
      raw: 'query=mutation',
      headers: { 'Content-Type': 'text/plain' },
    });
    expectFailure(res, 400);
    expect(requests).toHaveLength(0);
  });
});
