import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, inject, it } from 'vitest';
import { Client, expectSuccess } from './helpers/client.js';

describe('info', () => {
  const guest = Client.guest();

  it('reports server info', async () => {
    const info = expectSuccess(await guest.get('/api/info'));
    expect(info.production).toBe(true);
    expect(info.demo).toBe(false);
    const pkg = await import('../../package.json', {
      with: { type: 'json' },
    });
    expect(info.version).toBe(pkg.default.version);
  });

  it('describes the api in an OpenAPI document', async () => {
    const res = await guest.get('/api/openapi.json');
    expect(res.status).toBe(200);
    // The document itself, not wrapped like other answers
    const doc = res.json;
    expect(doc.openapi).toBe('3.0.3');
    const info = expectSuccess(await guest.get('/api/info'));
    expect(doc.info.version).toBe(info.version);

    const upload = doc.paths['/api/image/upload'].post;
    expect(upload['x-permissions']).toEqual(['image-upload']);
    expect(Object.keys(upload.requestBody.content)).toEqual([
      'multipart/form-data',
    ]);
    expect(upload.parameters).toContainEqual(
      expect.objectContaining({ name: 'expires_after', in: 'query' }),
    );
    const uploaded = upload.responses['201'].content['application/json'].schema;
    expect(uploaded.properties.data.properties.links.required).toEqual([
      'view',
      'image',
    ]);

    const list = doc.paths['/api/image/list'].post;
    expect(
      list.requestBody.content['application/json'].schema.required,
    ).toEqual(['count', 'page']);

    const image = doc.paths['/i/{id}'].get;
    expect(image.parameters[0]).toMatchObject({
      name: 'id',
      in: 'path',
      required: true,
    });
    expect(image.parameters.map((p: any) => p.name)).toContain('width');
    expect(Object.keys(image.responses['200'].content)).toEqual(['image/*']);

    // Path parameters in the order of the path
    const deleteLink = doc.paths['/api/image/delete/{id}/{key}'].get;
    expect(deleteLink.parameters.map((p: any) => p.name)).toEqual([
      'id',
      'key',
    ]);
    expect(Object.keys(deleteLink.responses)).toEqual(['302', 'default']);
    expect(deleteLink.responses['302'].headers.Location).toBeDefined();

    // Logging in reads the username and password from the body
    const login = doc.paths['/api/user/login'].post;
    expect(
      login.requestBody.content['application/json'].schema.required,
    ).toEqual(['username', 'password']);

    // Every operation has its own id, and every path can be called as it is
    const operations = Object.values<any>(doc.paths).flatMap((path) =>
      Object.values<any>(path),
    );
    const ids = operations.map((operation) => operation.operationId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(doc.paths).filter((path) => path.includes('*'))).toEqual(
      [],
    );
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
    expect(res.body.toString()).toContain('<app-root');
  });

  it('wraps unknown api routes in an error envelope', async () => {
    for (const path of ['/api/does-not-exist', '/api', '/api/image']) {
      const res = await guest.get(path);
      expect(res.status, path).toBe(404);
      expect(res.json.success).toBe(false);
      expect(res.json.data.type).toBe('routenotfound');
    }
    const post = await guest.post('/api/does-not-exist', {});
    expect(post.status).toBe(404);
    expect(post.json.success).toBe(false);
  });

  // The Docker image has its frontend inside the container
  it.runIf(inject('dockerImage') === null)(
    'serves frontend files added after startup',
    async () => {
      const root = inject('serverEnv')['PICSUR_STATIC_FRONTEND_ROOT'];
      writeFileSync(join(root, 'chunk-new.js'), 'console.log(1);');

      const res = await guest.get('/chunk-new.js');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('javascript');
      expect(res.body.toString()).toBe('console.log(1);');

      // Nothing outside of the frontend
      const outside = await guest.get('/..%2f..%2fpackage.json');
      expect(outside.headers.get('content-type')).toContain('text/html');
    },
  );

  it('serves the frontend for its own routes', async () => {
    for (const path of ['/upload', '/view/some-id', '/settings/users']) {
      const res = await guest.get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(res.body.toString()).toContain('<app-root');
    }
  });
});
