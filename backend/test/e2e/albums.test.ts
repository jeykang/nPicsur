import { beforeAll, describe, expect, it } from 'vitest';
import {
  Client,
  createUser,
  expectFailure,
  expectSuccess,
} from './helpers/client.js';
import { makePng } from './helpers/images.js';

describe('albums', () => {
  let admin: Client;
  let alice: Awaited<ReturnType<typeof createUser>>;
  let bob: Awaited<ReturnType<typeof createUser>>;

  beforeAll(async () => {
    admin = await Client.admin();
    alice = await createUser(admin);
    bob = await createUser(admin);
  });

  async function upload(user: typeof alice) {
    return (await user.client.uploadOk(await makePng())).id as string;
  }

  async function albumImages(id: string, client = Client.guest()) {
    const list = expectSuccess(
      await client.post('/api/album/images', { id, count: 100, page: 0 }),
    );
    return list.results.map((image: any) => image.id) as string[];
  }

  it('creates, lists, renames and deletes albums', async () => {
    const album = expectSuccess(
      await alice.client.post('/api/album/create', { name: '  Holiday  ' }),
    );
    expect(album).toMatchObject({
      name: 'Holiday',
      user_id: alice.id,
      image_count: 0,
      cover_id: null,
    });

    const list = expectSuccess(
      await alice.client.post('/api/album/list', { count: 10, page: 0 }),
    );
    expect(list.results.map((a: any) => a.id)).toEqual([album.id]);

    const renamed = expectSuccess(
      await alice.client.post('/api/album/update', {
        id: album.id,
        name: 'Summer',
      }),
    );
    expect(renamed.name).toBe('Summer');

    const image = await upload(alice);
    expectSuccess(
      await alice.client.post('/api/album/images/add', {
        id: album.id,
        image_ids: [image],
      }),
    );
    expectSuccess(
      await alice.client.post('/api/album/delete', { id: album.id }),
    );
    expectFailure(
      await Client.guest().post('/api/album/info', { id: album.id }),
      404,
      'notfound',
    );
    // The images stay
    expectSuccess(await Client.guest().get(`/i/meta/${image}`));
  });

  it('holds images, the ones added last first', async () => {
    const album = expectSuccess(
      await alice.client.post('/api/album/create', { name: 'Ordered' }),
    );
    const [one, two, three] = [
      await upload(alice),
      await upload(alice),
      await upload(alice),
    ];

    const added = expectSuccess(
      await alice.client.post('/api/album/images/add', {
        id: album.id,
        image_ids: [one, two],
      }),
    );
    expect(added.image_count).toBe(2);
    expect(added.cover_id).toBe(two);

    // Adding one that is already in it changes nothing
    const again = expectSuccess(
      await alice.client.post('/api/album/images/add', {
        id: album.id,
        image_ids: [one, three],
      }),
    );
    expect(again.image_count).toBe(3);
    expect(again.cover_id).toBe(three);
    expect(await albumImages(album.id)).toEqual([three, two, one]);

    const paged = expectSuccess(
      await Client.guest().post('/api/album/images', {
        id: album.id,
        count: 2,
        page: 1,
      }),
    );
    expect(paged.results.map((image: any) => image.id)).toEqual([one]);
    expect(paged.pages).toBe(2);

    const removed = expectSuccess(
      await alice.client.post('/api/album/images/remove', {
        id: album.id,
        image_ids: [three],
      }),
    );
    expect(removed.image_count).toBe(2);
    expect(removed.cover_id).toBe(two);
  });

  it('can be seen by anyone with the link', async () => {
    const album = expectSuccess(
      await alice.client.post('/api/album/create', { name: 'Shared' }),
    );
    const image = await upload(alice);
    expectSuccess(
      await alice.client.post('/api/album/images/add', {
        id: album.id,
        image_ids: [image],
      }),
    );

    const info = expectSuccess(
      await Client.guest().post('/api/album/info', { id: album.id }),
    );
    expect(info.album).toMatchObject({ name: 'Shared', image_count: 1 });
    expect(info.user).toEqual({ id: alice.id, username: alice.username });
    expect(await albumImages(album.id)).toEqual([image]);
  });

  it('only lets owners and image admins change them', async () => {
    const album = expectSuccess(
      await alice.client.post('/api/album/create', { name: 'Mine' }),
    );
    const bobsImage = await upload(bob);

    for (const [path, body] of [
      ['/api/album/update', { id: album.id, name: 'Taken' }],
      ['/api/album/delete', { id: album.id }],
      ['/api/album/images/add', { id: album.id, image_ids: [bobsImage] }],
      ['/api/album/images/remove', { id: album.id, image_ids: [bobsImage] }],
    ] as const) {
      expectFailure(await bob.client.post(path, body), 404, 'notfound');
    }
    expectFailure(
      await Client.guest().post('/api/album/create', { name: 'Guest' }),
      403,
      'permission',
    );

    // Others only see their own albums
    const bobsList = expectSuccess(
      await bob.client.post('/api/album/list', {
        count: 100,
        page: 0,
        user_id: alice.id,
      }),
    );
    expect(bobsList.results.map((a: any) => a.id)).not.toContain(album.id);

    const adminList = expectSuccess(
      await admin.post('/api/album/list', {
        count: 100,
        page: 0,
        user_id: alice.id,
      }),
    );
    expect(adminList.results.map((a: any) => a.id)).toContain(album.id);
    expectSuccess(
      await admin.post('/api/album/update', {
        id: album.id,
        name: 'Moderated',
      }),
    );
  });

  it("only takes the owner's own images", async () => {
    const album = expectSuccess(
      await alice.client.post('/api/album/create', { name: 'Own only' }),
    );
    const bobsImage = await upload(bob);
    expectFailure(
      await alice.client.post('/api/album/images/add', {
        id: album.id,
        image_ids: [bobsImage],
      }),
      404,
      'notfound',
    );

    // Mixed with one of her own, only hers is added
    const hers = await upload(alice);
    const added = expectSuccess(
      await alice.client.post('/api/album/images/add', {
        id: album.id,
        image_ids: [bobsImage, hers],
      }),
    );
    expect(added.image_count).toBe(1);
    expect(await albumImages(album.id)).toEqual([hers]);
  });

  it('tells which albums hold an image', async () => {
    const withIt = expectSuccess(
      await alice.client.post('/api/album/create', { name: 'With' }),
    );
    const without = expectSuccess(
      await alice.client.post('/api/album/create', { name: 'Without' }),
    );
    const image = await upload(alice);
    expectSuccess(
      await alice.client.post('/api/album/images/add', {
        id: withIt.id,
        image_ids: [image],
      }),
    );

    const list = expectSuccess(
      await alice.client.post('/api/album/list', {
        count: 100,
        page: 0,
        image_id: image,
      }),
    );
    const byId = new Map(list.results.map((a: any) => [a.id, a]));
    expect(byId.get(withIt.id)).toMatchObject({ contains_image: true });
    expect(byId.get(without.id)).toMatchObject({ contains_image: false });
  });

  it('loses images that are deleted or expire', async () => {
    const album = expectSuccess(
      await alice.client.post('/api/album/create', { name: 'Fleeting' }),
    );
    const [deleted, expiring, staying] = [
      await upload(alice),
      await upload(alice),
      await upload(alice),
    ];
    expectSuccess(
      await alice.client.post('/api/album/images/add', {
        id: album.id,
        image_ids: [deleted, expiring, staying],
      }),
    );

    expectSuccess(
      await alice.client.post('/api/image/delete', { ids: [deleted] }),
    );
    expectSuccess(
      await alice.client.post('/api/image/update', {
        id: expiring,
        expires_at: new Date(Date.now() + 1500),
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 2000));

    expect(await albumImages(album.id)).toEqual([staying]);
    const info = expectSuccess(
      await Client.guest().post('/api/album/info', { id: album.id }),
    );
    expect(info.album).toMatchObject({ image_count: 1, cover_id: staying });
  });

  it('are deleted along with their user', async () => {
    const carol = await createUser(admin);
    const album = expectSuccess(
      await carol.client.post('/api/album/create', { name: 'Gone' }),
    );
    expectSuccess(await admin.post('/api/user/delete', { id: carol.id }));
    expectFailure(
      await Client.guest().post('/api/album/info', { id: album.id }),
      404,
      'notfound',
    );
  });

  it('validates names and paging', async () => {
    for (const name of ['', '   ', 'x'.repeat(101)]) {
      expectFailure(
        await alice.client.post('/api/album/create', { name }),
        400,
        'usrvalidation',
      );
    }
    expectFailure(
      await alice.client.post('/api/album/list', { count: 1000, page: 0 }),
      400,
      'usrvalidation',
    );
  });
});
