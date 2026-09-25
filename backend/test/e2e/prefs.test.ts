import { beforeAll, describe, expect, it } from 'vitest';
import {
  Client,
  createUser,
  expectFailure,
  expectSuccess,
} from './helpers/client.js';

describe('system preferences', () => {
  let admin: Client;

  beforeAll(async () => {
    admin = await Client.admin();
  });

  it('lists all preferences with their types', async () => {
    const prefs = expectSuccess(await admin.get('/api/pref/sys'));
    const byKey = Object.fromEntries(prefs.results.map((p: any) => [p.key, p]));
    expect(byKey['allow_editing']).toMatchObject({ type: 'boolean' });
    expect(byKey['remove_derivatives_after']).toMatchObject({
      type: 'string',
    });
    expect(byKey['conversion_memory_limit']).toMatchObject({
      type: 'number',
    });
  });

  it('reads and writes a single preference', async () => {
    const original = expectSuccess(
      await admin.get('/api/pref/sys/remove_derivatives_after'),
    );

    const updated = expectSuccess(
      await admin.post('/api/pref/sys/remove_derivatives_after', {
        value: '3d',
      }),
    );
    expect(updated).toMatchObject({
      key: 'remove_derivatives_after',
      value: '3d',
      type: 'string',
    });
    expect(
      expectSuccess(await admin.get('/api/pref/sys/remove_derivatives_after'))
        .value,
    ).toBe('3d');

    expectSuccess(
      await admin.post('/api/pref/sys/remove_derivatives_after', {
        value: original.value,
      }),
    );
  });

  it('validates preference values', async () => {
    // Wrong type
    expectFailure(
      await admin.post('/api/pref/sys/allow_editing', { value: 'yes' }),
      400,
      'usrvalidation',
    );
    // Right type, invalid value
    expectFailure(
      await admin.post('/api/pref/sys/remove_derivatives_after', {
        value: 'not a duration',
      }),
      400,
      'usrvalidation',
    );
    // Unknown key
    expectFailure(
      await admin.post('/api/pref/sys/not_a_pref', { value: true }),
      400,
      'usrvalidation',
    );
  });

  it('never exposes the jwt secret', async () => {
    const prefs = expectSuccess(await admin.get('/api/pref/sys'));
    const keys = prefs.results.map((p: any) => p.key);
    expect(keys).not.toContain('jwt_secret');
    expect(JSON.stringify(prefs)).not.toContain('jwt_secret');

    expectFailure(
      await admin.get('/api/pref/sys/jwt_secret'),
      400,
      'usrvalidation',
    );
    expectFailure(
      await admin.post('/api/pref/sys/jwt_secret', {
        value: 'a'.repeat(64),
      }),
      400,
      'usrvalidation',
    );
  });

  it('does not phone home', async () => {
    const prefs = expectSuccess(await admin.get('/api/pref/sys'));
    const keys = prefs.results.map((p: any) => p.key);
    expect(keys).not.toContain('enable_telemetry');
  });

  it.each([
    ['bcrypt_strength', 40],
    ['bcrypt_strength', 1],
    ['conversion_memory_limit', 0],
    ['jwt_expires_in', '1s'],
    ['conversion_time_limit', '5h'],
    ['host_override', 'javascript:alert(1)'],
    ['host_override', 'not a url at all https://example.com'],
    ['tracking_url', 'ftp://example.com'],
  ])('refuses %s = %j', async (key, value) => {
    expectFailure(
      await admin.post(`/api/pref/sys/${key}`, { value }),
      400,
      'usrvalidation',
    );
  });

  it.each([
    ['host_override', 'https://img.example.com'],
    ['remove_derivatives_after', '0'],
    ['bcrypt_strength', 11],
  ])('accepts %s = %j', async (key, value) => {
    const original = expectSuccess(await admin.get(`/api/pref/sys/${key}`));
    try {
      expectSuccess(await admin.post(`/api/pref/sys/${key}`, { value }));
    } finally {
      expectSuccess(
        await admin.post(`/api/pref/sys/${key}`, { value: original.value }),
      );
    }
  });

  it('is off limits to normal users', async () => {
    const { client } = await createUser(admin);
    expectFailure(await client.get('/api/pref/sys'), 403, 'permission');
    expectFailure(
      await client.post('/api/pref/sys/allow_editing', { value: false }),
      403,
      'permission',
    );
  });
});

describe('user preferences', () => {
  it('are kept per user', async () => {
    const admin = await Client.admin();
    const alice = await createUser(admin);
    const bob = await createUser(admin);

    const initial = expectSuccess(
      await alice.client.get('/api/pref/usr/keep_original'),
    );
    expect(initial).toMatchObject({ value: false, type: 'boolean' });

    expectSuccess(
      await alice.client.post('/api/pref/usr/keep_original', { value: true }),
    );
    expect(
      expectSuccess(await alice.client.get('/api/pref/usr/keep_original'))
        .value,
    ).toBe(true);
    expect(
      expectSuccess(await bob.client.get('/api/pref/usr/keep_original')).value,
    ).toBe(false);

    const all = expectSuccess(await alice.client.get('/api/pref/usr'));
    expect(all.results).toEqual([
      expect.objectContaining({ key: 'keep_original', value: true }),
    ]);
  });

  it('are not available to guests', async () => {
    expectFailure(await Client.guest().get('/api/pref/usr'), 403, 'permission');
  });
});
