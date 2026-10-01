import { describe, expect, it } from 'vitest';
import {
  Client,
  createUser,
  expectFailure,
  expectSuccess,
} from './helpers/client.js';

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
