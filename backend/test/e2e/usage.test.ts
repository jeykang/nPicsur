import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, expectFailure, expectSuccess } from './helpers/client.js';

// The frontend reports visitor statistics through /api/usage/report, which
// passes them on to the Ackee server in the tracking_url preference. Here a
// stand-in plays a tracking server that answers the way a hostile one would.
describe('usage statistics', () => {
  let admin: Client;
  let server: Server;
  let requests: { headers: IncomingHttpHeaders; body: string }[] = [];
  let answer: { type: string; body: string };

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

    expectSuccess(
      await admin.post('/api/pref/sys/tracking_url', {
        value: `http://127.0.0.1:${port}/`,
      }),
    );
  });

  afterAll(async () => {
    await admin.post('/api/pref/sys/tracking_url', { value: '' });
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
