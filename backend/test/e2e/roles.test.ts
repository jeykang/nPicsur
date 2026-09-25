import { beforeAll, describe, expect, it } from 'vitest';
import {
  Client,
  createUser,
  expectFailure,
  expectSuccess,
  uniqueName,
} from './helpers/client.js';

function roleName() {
  // Role names are 4-32 alphanumeric characters
  return uniqueName('role').slice(0, 32);
}

describe('roles', () => {
  let admin: Client;

  beforeAll(async () => {
    admin = await Client.admin();
  });

  it('lists the system roles', async () => {
    const list = expectSuccess(await admin.get('/api/roles/list'));
    const names = list.results.map((r: any) => r.name);
    expect(names).toEqual(expect.arrayContaining(['guest', 'user', 'admin']));

    const special = expectSuccess(await admin.get('/api/roles/special'));
    expect(special.ImmutableRoles).toEqual(['admin']);
    expect(special.SoulBoundRoles).toEqual(['guest', 'user']);
  });

  it('creates, updates and deletes a custom role', async () => {
    const name = roleName();
    const created = expectSuccess(
      await admin.post('/api/roles/create', {
        name,
        permissions: ['image-view'],
      }),
    );
    expect(created.permissions).toEqual(['image-view']);

    const updated = expectSuccess(
      await admin.post('/api/roles/update', {
        name,
        permissions: ['image-view', 'image-upload'],
      }),
    );
    expect(updated.permissions.sort()).toEqual(['image-upload', 'image-view']);

    const info = expectSuccess(await admin.post('/api/roles/info', { name }));
    expect(info.permissions.sort()).toEqual(['image-upload', 'image-view']);

    expectSuccess(await admin.post('/api/roles/delete', { name }));
    expectFailure(
      await admin.post('/api/roles/info', { name }),
      404,
      'notfound',
    );
  });

  it('grants the permissions of custom roles to their users', async () => {
    const name = roleName();
    expectSuccess(
      await admin.post('/api/roles/create', {
        name,
        permissions: ['user-admin'],
      }),
    );
    const { client, id } = await createUser(admin, [name]);
    expectSuccess(await client.post('/api/user/list', { count: 1, page: 0 }));

    // Deleting the role takes it away from everyone that had it
    expectSuccess(await admin.post('/api/roles/delete', { name }));
    const user = expectSuccess(await admin.post('/api/user/info', { id }));
    expect(user.roles).toEqual(['user']);
    expectFailure(
      await client.post('/api/user/list', { count: 1, page: 0 }),
      403,
      'permission',
    );
  });

  it.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty'])(
    'handles a role called %s',
    async (name) => {
      expectSuccess(
        await admin.post('/api/roles/create', { name, permissions: [] }),
      );
      try {
        const updated = expectSuccess(
          await admin.post('/api/roles/update', {
            name,
            permissions: ['image-view'],
          }),
        );
        expect(updated.permissions).toEqual(['image-view']);
      } finally {
        await admin.post('/api/roles/delete', { name });
      }
    },
  );

  it('refuses unknown permissions', async () => {
    const res = await admin.post('/api/roles/create', {
      name: roleName(),
      permissions: ['not-a-permission'],
    });
    expectFailure(res, 400, 'usrvalidation');
  });

  it('refuses duplicate roles', async () => {
    const name = roleName();
    expectSuccess(
      await admin.post('/api/roles/create', { name, permissions: [] }),
    );
    expectFailure(
      await admin.post('/api/roles/create', { name, permissions: [] }),
      409,
      'conflict',
    );
  });

  it('protects the system roles', async () => {
    expectFailure(
      await admin.post('/api/roles/update', {
        name: 'admin',
        permissions: [],
      }),
      403,
      'permission',
    );
    for (const name of ['guest', 'user', 'admin']) {
      expectFailure(
        await admin.post('/api/roles/delete', { name }),
        403,
        'permission',
      );
    }
    // Guests must always be able to log in
    expectFailure(
      await admin.post('/api/roles/update', {
        name: 'guest',
        permissions: ['image-view'],
      }),
      403,
      'permission',
    );
  });

  it('is off limits to normal users', async () => {
    const { client } = await createUser(admin);
    expectFailure(await client.get('/api/roles/list'), 403, 'permission');
    expectFailure(
      await client.post('/api/roles/update', {
        name: 'user',
        permissions: ['user-admin'],
      }),
      403,
      'permission',
    );
  });
});
