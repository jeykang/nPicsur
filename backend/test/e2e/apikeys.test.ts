import { beforeAll, describe, expect, it } from 'vitest';
import {
  Client,
  createUser,
  expectFailure,
  expectSuccess,
} from './helpers/client.js';
import { makePng } from './helpers/images.js';

describe('api keys', () => {
  let admin: Client;

  beforeAll(async () => {
    admin = await Client.admin();
  });

  it('creates a key that authenticates as its owner', async () => {
    const { client, id: userId, username } = await createUser(admin);
    const key = expectSuccess(await client.post('/api/apikeys/create'));
    expect(key.key).toMatch(/^[a-zA-Z0-9]{32}$/);
    expect(key.user).toBe(userId);

    const viaKey = Client.withApiKey(key.key);
    const perms = expectSuccess(await viaKey.get('/api/user/me/permissions'));
    expect(perms.permissions).toContain('image-upload');

    const me = expectSuccess(await viaKey.get('/api/user/me'));
    expect(me.user.username).toBe(username);
    // But it can not be traded in for a session token
    expect(me.token).toBe('');

    // Uploading with an api key is the ShareX use case
    const image = await viaKey.uploadOk(await makePng(), 'sharex.png');
    expect(image.user_id).toBe(userId);
  });

  it('lists, renames and deletes keys', async () => {
    const { client } = await createUser(admin);
    const key = expectSuccess(await client.post('/api/apikeys/create'));

    const list = expectSuccess(
      await client.post('/api/apikeys/list', { count: 10, page: 0 }),
    );
    expect(list.total).toBe(1);
    expect(list.results[0].id).toBe(key.id);

    const renamed = expectSuccess(
      await client.post('/api/apikeys/update', {
        id: key.id,
        name: 'my sharex key',
      }),
    );
    expect(renamed.name).toBe('my sharex key');

    const info = expectSuccess(
      await client.post('/api/apikeys/info', { id: key.id }),
    );
    expect(info.name).toBe('my sharex key');

    expectSuccess(await client.post('/api/apikeys/delete', { id: key.id }));

    // The key no longer authenticates, the request falls back to guest
    const viaKey = Client.withApiKey(key.key);
    const perms = expectSuccess(await viaKey.get('/api/user/me/permissions'));
    expect(perms.permissions).not.toContain('image-upload');
  });

  it('keeps listing keys with short names', async () => {
    const { client } = await createUser(admin);
    const key = expectSuccess(await client.post('/api/apikeys/create'));
    expectSuccess(
      await client.post('/api/apikeys/update', { id: key.id, name: 'x' }),
    );
    const list = expectSuccess(
      await client.post('/api/apikeys/list', { count: 10, page: 0 }),
    );
    expect(list.results[0].name).toBe('x');
  });

  it('records when a key was last used', async () => {
    const { client } = await createUser(admin);
    const key = expectSuccess(await client.post('/api/apikeys/create'));
    expect(key.last_used).toBeNull();

    await Client.withApiKey(key.key).get('/api/user/me/permissions');
    // The timestamp is updated in the background
    await new Promise((r) => setTimeout(r, 500));

    const info = expectSuccess(
      await client.post('/api/apikeys/info', { id: key.id }),
    );
    expect(info.last_used).not.toBeNull();
  });

  it("hides other users' keys", async () => {
    const alice = await createUser(admin);
    const bob = await createUser(admin);
    const key = expectSuccess(await alice.client.post('/api/apikeys/create'));

    expectFailure(
      await bob.client.post('/api/apikeys/info', { id: key.id }),
      404,
      'notfound',
    );
    expectFailure(
      await bob.client.post('/api/apikeys/update', {
        id: key.id,
        name: 'stolen',
      }),
      404,
      'notfound',
    );
    expectFailure(
      await bob.client.post('/api/apikeys/delete', { id: key.id }),
      404,
      'notfound',
    );

    // Asking for someone else's keys only returns your own
    const list = expectSuccess(
      await bob.client.post('/api/apikeys/list', {
        count: 10,
        page: 0,
        user_id: alice.id,
      }),
    );
    expect(list.total).toBe(0);

    // Admins can see everyone's keys, but not the keys themselves
    const adminList = expectSuccess(
      await admin.post('/api/apikeys/list', {
        count: 10,
        page: 0,
        user_id: alice.id,
      }),
    );
    expect(adminList.total).toBe(1);
    expect(adminList.results[0].key).toBe('');
  });

  it('deletes the keys of deleted users', async () => {
    const { client, id } = await createUser(admin);
    const key = expectSuccess(await client.post('/api/apikeys/create'));
    expectSuccess(await admin.post('/api/user/delete', { id }));

    const perms = expectSuccess(
      await Client.withApiKey(key.key).get('/api/user/me/permissions'),
    );
    expect(perms.permissions).not.toContain('image-upload');
  });

  it('is not available to guests', async () => {
    expectFailure(
      await Client.guest().post('/api/apikeys/create'),
      403,
      'permission',
    );
  });
});
