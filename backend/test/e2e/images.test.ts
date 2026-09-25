import { randomBytes, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import {
  Client,
  createUser,
  expectFailure,
  expectSuccess,
} from './helpers/client.js';
import {
  convertTo,
  makeAnimatedGif,
  makeJpeg,
  makePng,
  metadata,
} from './helpers/images.js';

describe('image upload and retrieval', () => {
  let admin: Client;
  let user: Awaited<ReturnType<typeof createUser>>;
  let png: Buffer;
  let imageId: string;

  beforeAll(async () => {
    admin = await Client.admin();
    user = await createUser(admin);
    png = await makePng(64, 48);
    imageId = (await user.client.uploadOk(png, 'holiday.final.png')).id;
  });

  it('returns the new image, with a delete key', async () => {
    const res = await user.client.upload(png, 'another.png');
    const image = expectSuccess(res);
    expect(image.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(image.user_id).toBe(user.id);
    // The extension is stripped from the name
    expect(image.file_name).toBe('another');
    expect(image.expires_at).toBeNull();
    expect(image.delete_key).toMatch(/^[a-zA-Z0-9]{32}$/);
  });

  it('only strips the last extension', async () => {
    const meta = expectSuccess(await user.client.get(`/i/meta/${imageId}`));
    expect(meta.image.file_name).toBe('holiday.final');
  });

  it('does not let guests upload by default', async () => {
    expectFailure(await Client.guest().upload(png), 403, 'permission');
  });

  it('refuses files that are not images', async () => {
    const res = await user.client.upload(
      Buffer.from('this is not an image, just some text'),
      'notes.txt',
    );
    expect(res.json.success).toBe(false);
    expect(res.status).toBe(400);
  });

  it('refuses files over the size limit', async () => {
    // Random pixels don't compress, so this stays over the limit
    const height = Math.ceil(inject('maxFileSize') / 3000) + 1;
    const big = await sharp(randomBytes(1000 * height * 3), {
      raw: { width: 1000, height, channels: 3 },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    expect(big.length).toBeGreaterThan(inject('maxFileSize'));

    const res = await user.client.upload(big, 'big.png');
    expect(res.json.success).toBe(false);
    expect(res.status).toBe(400);
  });

  it('refuses requests without a file', async () => {
    const res = await user.client.request('POST', '/api/image/upload', {
      form: new FormData(),
    });
    expect(res.json.success).toBe(false);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('serves image metadata', async () => {
    const meta = expectSuccess(await Client.guest().get(`/i/meta/${imageId}`));
    expect(meta.image.id).toBe(imageId);
    expect(meta.image).not.toHaveProperty('delete_key');
    expect(meta.user).toMatchObject({ id: user.id, username: user.username });
    expect(meta.fileTypes).toEqual({ master: 'image:qoi' });
  });

  it.each([
    ['png', 'image/png', 'png'],
    ['jpg', 'image/jpeg', 'jpeg'],
    ['webp', 'image/webp', 'webp'],
    ['gif', 'image/gif', 'gif'],
    ['tiff', 'image/tiff', 'tiff'],
    ['avif', 'image/avif', 'heif'],
  ])('converts to %s', async (ext, mime, sharpFormat) => {
    const res = await Client.guest().get(`/i/${imageId}.${ext}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(mime);
    const meta = await metadata(res.body);
    expect(meta.format).toBe(sharpFormat);
    expect(meta.width).toBe(64);
    expect(meta.height).toBe(48);
  });

  it.each([
    ['qoi', 'image/x-qoi', 'qoif'],
    ['bmp', 'image/bmp', 'BM'],
  ])('converts to %s', async (ext, mime, magic) => {
    const res = await Client.guest().get(`/i/${imageId}.${ext}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(mime);
    expect(res.body.subarray(0, magic.length).toString('latin1')).toBe(magic);
  });

  it('keeps the pixels intact in lossless formats', async () => {
    const res = await Client.guest().get(`/i/${imageId}.png`);
    const served = await sharp(res.body).raw().toBuffer();
    const source = await sharp(png).raw().toBuffer();
    expect(served.equals(source)).toBe(true);
  });

  it('answers HEAD requests with the right type', async () => {
    const res = await Client.guest().head(`/i/${imageId}.webp`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
  });

  it('serves images cross origin and cacheable', async () => {
    const res = await Client.guest().get(`/i/${imageId}.png`, {
      headers: { Origin: 'https://example.com' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('cross-origin-resource-policy')).toBe(
      'cross-origin',
    );
    expect(res.headers.get('cache-control')).toMatch(/max-age=\d+/);
  });

  it('rejects malformed image ids', async () => {
    expectFailure(
      await Client.guest().get('/i/not-an-id.png'),
      400,
      'usrvalidation',
    );
    expectFailure(
      await Client.guest().get(`/i/${imageId}.exe`),
      400,
      'usrvalidation',
    );
    expectFailure(
      await Client.guest().get('/i/meta/not-an-id'),
      400,
      'usrvalidation',
    );
  });

  it('serves an uncacheable placeholder for unknown images', async () => {
    const res = await Client.guest().get(`/i/${randomUUID()}.png`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect((await metadata(res.body)).format).toBe('png');
  });

  it('answers cross origin preflight requests for images', async () => {
    const res = await Client.guest().request('OPTIONS', `/i/${imageId}.png`, {
      headers: {
        Origin: 'https://example.com',
        'Access-Control-Request-Method': 'GET',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toContain('GET');
  });

  it('does not cache image metadata', async () => {
    const res = await Client.guest().get(`/i/meta/${imageId}`);
    expect(res.headers.get('cache-control') ?? '').not.toMatch(/max-age=[1-9]/);
  });

  it('reports unknown images in the metadata endpoint', async () => {
    expectFailure(
      await Client.guest().get(`/i/meta/${randomUUID()}`),
      404,
      'notfound',
    );
  });
});

describe('image editing parameters', () => {
  let imageId: string;

  beforeAll(async () => {
    const admin = await Client.admin();
    imageId = (await admin.uploadOk(await makePng(64, 48))).id;
  });

  async function fetchMeta(query: string) {
    const res = await Client.guest().get(`/i/${imageId}.png?${query}`);
    expect(res.status).toBe(200);
    return metadata(res.body);
  }

  it('resizes keeping the aspect ratio', async () => {
    const meta = await fetchMeta('width=32');
    expect([meta.width, meta.height]).toEqual([32, 24]);
  });

  it('resizes to exact dimensions', async () => {
    const meta = await fetchMeta('width=10&height=30');
    expect([meta.width, meta.height]).toEqual([10, 30]);
  });

  it('only shrinks when asked to', async () => {
    const grown = await fetchMeta('width=128');
    expect(grown.width).toBe(128);
    const notGrown = await fetchMeta('width=128&shrinkonly=true');
    expect(notGrown.width).toBe(64);
  });

  it('rotates', async () => {
    const meta = await fetchMeta('rotate=90');
    expect([meta.width, meta.height]).toEqual([48, 64]);
  });

  it('removes the alpha channel', async () => {
    const meta = await fetchMeta('noalpha=true');
    expect(meta.hasAlpha).toBe(false);
  });

  it('converts to greyscale', async () => {
    const res = await Client.guest().get(`/i/${imageId}.png?greyscale=true`);
    const { data, info } = await sharp(res.body)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i += info.channels) {
      if (info.channels === 1) break;
      expect(data[i]).toBe(data[i + 1]);
      expect(data[i]).toBe(data[i + 2]);
    }
  });

  it('rejects out of range parameters', async () => {
    for (const query of ['width=0', 'width=100000', 'rotate=45', 'quality=0']) {
      const res = await Client.guest().get(`/i/${imageId}.png?${query}`);
      expect(res.status, query).toBe(400);
    }
  });

  it('allows upscaling, but not to gigantic sizes', async () => {
    const big = await fetchMeta('width=4000');
    expect([big.width, big.height]).toEqual([4000, 3000]);

    for (const query of [
      'width=30000',
      'height=20000',
      'width=5000&height=5000',
    ]) {
      const res = await Client.guest().get(`/i/${imageId}.png?${query}`);
      expect(res.status, query).toBe(400);
      expect(res.json.data.message).toContain('too large');
    }

    // Unless it would not be upscaled anyway
    const shrunk = await fetchMeta('width=30000&shrinkonly=true');
    expect(shrunk.width).toBe(64);
  });

  it('limits how many new conversions a client can ask for', async () => {
    const client = Client.pinned();
    const statuses: number[] = [];
    for (let width = 100; width < 140; width++) {
      statuses.push(
        (await client.get(`/i/${imageId}.jpg?width=${width}`)).status,
      );
    }
    expect(statuses.filter((s) => s === 200).length).toBe(30);
    expect(statuses.filter((s) => s === 429).length).toBe(10);

    // Conversions that already exist are not limited
    expect((await client.get(`/i/${imageId}.jpg?width=100`)).status).toBe(200);
    // Other clients are not affected
    expect(
      (await Client.guest().get(`/i/${imageId}.jpg?width=139`)).status,
    ).toBe(200);
  });

  it('handles many conversions at once', async () => {
    const results = await Promise.all(
      Array.from({ length: 24 }, (_, i) =>
        Client.guest().get(`/i/${imageId}.webp?width=${200 + i}`),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(Array(24).fill(200));
  });

  it('ignores editing parameters when editing is disabled', async () => {
    const admin = await Client.admin();
    expectSuccess(
      await admin.post('/api/pref/sys/allow_editing', { value: false }),
    );
    try {
      const meta = await fetchMeta('width=16');
      expect(meta.width).toBe(64);
    } finally {
      expectSuccess(
        await admin.post('/api/pref/sys/allow_editing', { value: true }),
      );
    }
    const meta = await fetchMeta('width=16');
    expect(meta.width).toBe(16);
  });
});

describe('formats', () => {
  let client: Client;

  beforeAll(async () => {
    client = await Client.admin();
  });

  it.each(['jpeg', 'webp', 'gif', 'tiff', 'avif'] as const)(
    'accepts %s uploads',
    async (format) => {
      const source =
        format === 'jpeg'
          ? await makeJpeg(40, 30)
          : await convertTo(await makePng(40, 30), format);
      const { id } = await client.uploadOk(source, `upload.${format}`);
      const meta = await metadata(
        (await Client.guest().get(`/i/${id}.png`)).body,
      );
      expect([meta.width, meta.height]).toEqual([40, 30]);
    },
  );

  it('keeps animations animated', async () => {
    const gif = makeAnimatedGif(3);
    const { id } = await client.uploadOk(gif, 'animated.gif');

    const meta = expectSuccess(await Client.guest().get(`/i/meta/${id}`));
    expect(meta.fileTypes.master).toBe('anim:webp');

    const asGif = await metadata(
      (await Client.guest().get(`/i/${id}.gif`)).body,
    );
    expect(asGif.format).toBe('gif');
    expect(asGif.pages).toBe(3);

    const asWebp = await metadata(
      (await Client.guest().get(`/i/${id}.webp`)).body,
    );
    expect(asWebp.format).toBe('webp');
    expect(asWebp.pages).toBe(3);

    // Still formats get the first frame
    const asPng = await metadata(
      (await Client.guest().get(`/i/${id}.png`)).body,
    );
    expect(asPng.format).toBe('png');
    expect(asPng.pages ?? 1).toBe(1);
  });

  it('strips exif data', async () => {
    const withExif = await sharp(await makeJpeg())
      .withExif({ IFD0: { Copyright: 'secret location' } })
      .jpeg()
      .toBuffer();
    expect((await metadata(withExif)).exif).toBeDefined();

    const { id } = await client.uploadOk(withExif, 'exif.jpg');
    const served = await Client.guest().get(`/i/${id}.jpg`);
    const meta = await metadata(served.body);
    expect(meta.exif).toBeUndefined();
    expect(served.body.includes(Buffer.from('secret location'))).toBe(false);
  });
});

describe('keeping originals', () => {
  it('stores and serves the original file when enabled', async () => {
    const admin = await Client.admin();
    const { client } = await createUser(admin);
    expectSuccess(
      await client.post('/api/pref/usr/keep_original', { value: true }),
    );

    const jpeg = await makeJpeg();
    const { id } = await client.uploadOk(jpeg, 'original.jpg');

    const meta = expectSuccess(await Client.guest().get(`/i/meta/${id}`));
    expect(meta.fileTypes).toEqual({
      master: 'image:qoi',
      original: 'image:jpeg',
    });

    const res = await Client.guest().get(`/i/${id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.body.equals(jpeg)).toBe(true);

    const head = await Client.guest().head(`/i/${id}`);
    expect(head.headers.get('content-type')).toBe('image/jpeg');
  });

  it('does not keep the original by default', async () => {
    const admin = await Client.admin();
    const { client } = await createUser(admin);
    const { id } = await client.uploadOk(await makeJpeg(), 'photo.jpg');

    const meta = expectSuccess(await Client.guest().get(`/i/meta/${id}`));
    expect(meta.fileTypes).toEqual({ master: 'image:qoi' });

    // Asking for the original gives the "not found" placeholder
    const res = await Client.guest().get(`/i/${id}`);
    expect(res.headers.get('content-type')).toBe('image/png');
  });
});

describe('image management', () => {
  let admin: Client;
  let alice: Awaited<ReturnType<typeof createUser>>;
  let bob: Awaited<ReturnType<typeof createUser>>;
  let png: Buffer;

  beforeAll(async () => {
    admin = await Client.admin();
    alice = await createUser(admin);
    bob = await createUser(admin);
    png = await makePng(16, 16);
  });

  it('lists your own images, newest first', async () => {
    const first = await alice.client.uploadOk(png, 'first.png');
    const second = await alice.client.uploadOk(png, 'second.png');
    await bob.client.uploadOk(png, 'bobs.png');

    const list = expectSuccess(
      await alice.client.post('/api/image/list', { count: 10, page: 0 }),
    );
    const ids = list.results.map((i: any) => i.id);
    expect(ids.slice(0, 2)).toEqual([second.id, first.id]);
    expect(list.results.every((i: any) => i.user_id === alice.id)).toBe(true);

    // Trying to peek at someone else's images still only shows your own
    const peek = expectSuccess(
      await alice.client.post('/api/image/list', {
        count: 10,
        page: 0,
        user_id: bob.id,
      }),
    );
    expect(peek.results.every((i: any) => i.user_id === alice.id)).toBe(true);

    // Admins can look at everyone's images
    const bobs = expectSuccess(
      await admin.post('/api/image/list', {
        count: 10,
        page: 0,
        user_id: bob.id,
      }),
    );
    expect(bobs.results.map((i: any) => i.file_name)).toEqual(['bobs']);
  });

  it('paginates', async () => {
    const carol = await createUser(admin);
    for (let i = 0; i < 5; i++) await carol.client.uploadOk(png, `${i}.png`);

    const page = expectSuccess(
      await carol.client.post('/api/image/list', { count: 2, page: 1 }),
    );
    expect(page).toMatchObject({ total: 5, page: 1, pages: 3 });
    expect(page.results.map((i: any) => i.file_name)).toEqual(['2', '1']);

    expectFailure(
      await carol.client.post('/api/image/list', { count: 1000, page: 0 }),
      400,
      'usrvalidation',
    );
  });

  it('renames images and sets an expiry date', async () => {
    const { id } = await alice.client.uploadOk(png, 'before.png');
    const expires = new Date(Date.now() + 60 * 60 * 1000);

    const updated = expectSuccess(
      await alice.client.post('/api/image/update', {
        id,
        file_name: 'after',
        expires_at: expires.toISOString(),
      }),
    );
    expect(updated.file_name).toBe('after');
    expect(new Date(updated.expires_at).getTime()).toBe(expires.getTime());

    // Removing the expiry again
    const cleared = expectSuccess(
      await alice.client.post('/api/image/update', { id, expires_at: null }),
    );
    expect(cleared.expires_at).toBeNull();
  });

  it('refuses expiry dates in the past', async () => {
    const { id } = await alice.client.uploadOk(png);
    expectFailure(
      await alice.client.post('/api/image/update', {
        id,
        expires_at: new Date(Date.now() - 1000).toISOString(),
      }),
      400,
      'usrvalidation',
    );
  });

  it("does not let you touch other people's images", async () => {
    const { id } = await alice.client.uploadOk(png);
    expectFailure(
      await bob.client.post('/api/image/update', { id, file_name: 'mine' }),
      404,
      'notfound',
    );
    expectFailure(
      await bob.client.post('/api/image/delete', { ids: [id] }),
      404,
      'notfound',
    );
    // Still there
    expectSuccess(await Client.guest().get(`/i/meta/${id}`));
  });

  it('deletes images', async () => {
    const one = await alice.client.uploadOk(png);
    const two = await alice.client.uploadOk(png);
    // Fetch a derivative first, so it has cached data to clean up
    await Client.guest().get(`/i/${one.id}.webp`);

    const res = expectSuccess(
      await alice.client.post('/api/image/delete', { ids: [one.id, two.id] }),
    );
    expect(res.images.map((i: any) => i.id).sort()).toEqual(
      [one.id, two.id].sort(),
    );

    expectFailure(
      await Client.guest().get(`/i/meta/${one.id}`),
      404,
      'notfound',
    );
    const gone = await Client.guest().get(`/i/${one.id}.webp`);
    expect(gone.headers.get('content-type')).toBe('image/png');
  });

  it("lets admins delete anyone's images", async () => {
    const { id } = await bob.client.uploadOk(png);
    expectSuccess(await admin.post('/api/image/delete', { ids: [id] }));
    expectFailure(await Client.guest().get(`/i/meta/${id}`), 404, 'notfound');
  });

  it('deletes images with their delete key', async () => {
    const { id, delete_key } = await alice.client.uploadOk(png);
    const guest = Client.guest();

    expectFailure(
      await guest.post('/api/image/delete/key', {
        id,
        key: 'A'.repeat(32),
      }),
      404,
      'notfound',
    );

    const deleted = expectSuccess(
      await guest.post('/api/image/delete/key', { id, key: delete_key }),
    );
    expect(deleted.id).toBe(id);
    expect(deleted).not.toHaveProperty('delete_key');
    expectFailure(await guest.get(`/i/meta/${id}`), 404, 'notfound');
  });

  it('deletes images through the delete link', async () => {
    const { id, delete_key } = await alice.client.uploadOk(png);
    const guest = Client.guest();

    const bad = await guest.get(`/api/image/delete/${id}/${'A'.repeat(32)}`, {
      manualRedirect: true,
    });
    expect(bad.status).toBe(302);
    expect(bad.headers.get('location')).toBe('/error/delete-failure');

    const good = await guest.get(`/api/image/delete/${id}/${delete_key}`, {
      manualRedirect: true,
    });
    expect(good.status).toBe(302);
    expect(good.headers.get('location')).toBe('/error/delete-success');
    expectFailure(await guest.get(`/i/meta/${id}`), 404, 'notfound');
  });
});
