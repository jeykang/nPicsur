import { beforeAll, describe, expect, it } from 'vitest';
import {
  Client,
  createUser,
  expectFailure,
  expectSuccess,
} from './helpers/client.js';
import { makePng } from './helpers/images.js';

describe('gallery', () => {
  let admin: Client;
  let alice: Awaited<ReturnType<typeof createUser>>;
  let bob: Awaited<ReturnType<typeof createUser>>;

  beforeAll(async () => {
    admin = await Client.admin();
    alice = await createUser(admin);
    bob = await createUser(admin);
  });

  async function galleryIds(client = Client.guest()) {
    const list = expectSuccess(
      await client.post('/api/gallery/list', { count: 100, page: 0 }),
    );
    return list.results.map((image: any) => image.id) as string[];
  }

  it('only shows images their owners chose to show', async () => {
    const shown = await alice.client.uploadOk(await makePng(), 'shown.png');
    const hidden = await alice.client.uploadOk(await makePng(), 'hidden.png');
    expect(shown.listed).toBe(false);

    const updated = expectSuccess(
      await alice.client.post('/api/image/update', {
        id: shown.id,
        listed: true,
      }),
    );
    expect(updated.listed).toBe(true);

    const list = expectSuccess(
      await Client.guest().post('/api/gallery/list', { count: 100, page: 0 }),
    );
    const entry = list.results.find((image: any) => image.id === shown.id);
    expect(entry).toMatchObject({
      file_name: 'shown',
      listed: true,
      user: { id: alice.id, username: alice.username },
    });
    expect(entry).not.toHaveProperty('delete_key');
    expect(list.results.map((image: any) => image.id)).not.toContain(hidden.id);

    expectSuccess(
      await alice.client.post('/api/image/update', {
        id: shown.id,
        listed: false,
      }),
    );
    expect(await galleryIds()).not.toContain(shown.id);
  });

  it('shows the newest first, in pages', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { id } = await bob.client.uploadOk(await makePng());
      expectSuccess(
        await bob.client.post('/api/image/update', { id, listed: true }),
      );
      ids.push(id);
    }

    const first = expectSuccess(
      await Client.guest().post('/api/gallery/list', { count: 2, page: 0 }),
    );
    expect(first.results.map((image: any) => image.id)).toEqual([
      ids[2],
      ids[1],
    ]);
    expect(first.pages).toBe(Math.ceil(first.total / 2));
    const second = expectSuccess(
      await Client.guest().post('/api/gallery/list', { count: 2, page: 1 }),
    );
    expect(second.results[0].id).toBe(ids[0]);
  });

  it('leaves out expired images', async () => {
    const { id } = await alice.client.uploadOk(await makePng());
    expectSuccess(
      await alice.client.post('/api/image/update', {
        id,
        listed: true,
        expires_at: new Date(Date.now() + 1500),
      }),
    );
    expect(await galleryIds()).toContain(id);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect(await galleryIds()).not.toContain(id);
  });

  it('only lets owners and image admins show images', async () => {
    const { id } = await alice.client.uploadOk(await makePng());
    expectFailure(
      await bob.client.post('/api/image/update', { id, listed: true }),
      404,
      'notfound',
    );
    expect(await galleryIds()).not.toContain(id);

    expectSuccess(await admin.post('/api/image/update', { id, listed: true }));
    expect(await galleryIds()).toContain(id);
  });

  it('can be closed to guests', async () => {
    const guestRole = expectSuccess(
      await admin.post('/api/roles/info', { name: 'guest' }),
    );
    expect(guestRole.permissions).toContain('gallery-view');

    expectSuccess(
      await admin.post('/api/roles/update', {
        name: 'guest',
        permissions: guestRole.permissions.filter(
          (p: string) => p !== 'gallery-view',
        ),
      }),
    );
    try {
      expectFailure(
        await Client.guest().post('/api/gallery/list', { count: 10, page: 0 }),
        403,
        'permission',
      );
      // Users still see it
      await galleryIds(alice.client);
    } finally {
      expectSuccess(
        await admin.post('/api/roles/update', {
          name: 'guest',
          permissions: guestRole.permissions,
        }),
      );
    }
  });

  it('validates paging', async () => {
    expectFailure(
      await Client.guest().post('/api/gallery/list', { count: 1000, page: 0 }),
      400,
      'usrvalidation',
    );
  });
});
