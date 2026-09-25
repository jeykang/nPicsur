import { beforeAll, describe, expect, it } from 'vitest';
import {
  Client,
  createUser,
  expectFailure,
  expectSuccess,
  uniqueName,
} from './helpers/client.js';

// Users who may manage users, roles or api keys, but are not full
// administrators, must not be able to make themselves one

function roleName() {
  return uniqueName('role').slice(0, 32);
}

async function createRole(admin: Client, permissions: string[]) {
  const name = roleName();
  expectSuccess(await admin.post('/api/roles/create', { name, permissions }));
  return name;
}

describe('delegated administration', () => {
  let admin: Client;
  let adminId: string;

  beforeAll(async () => {
    admin = await Client.admin();
    adminId = expectSuccess(await admin.get('/api/user/me')).user.id;
  });

  describe('user administrators', () => {
    let userAdminRole: string;
    let userAdmin: Awaited<ReturnType<typeof createUser>>;

    beforeAll(async () => {
      userAdminRole = await createRole(admin, ['user-admin']);
      userAdmin = await createUser(admin, [userAdminRole]);
    });

    it("can not change the admin's password", async () => {
      expectFailure(
        await userAdmin.client.post('/api/user/update', {
          id: adminId,
          password: 'taken-over',
        }),
        403,
        'permission',
      );
      // The real password still works
      await Client.admin();
    });

    it('can not make themselves an admin', async () => {
      expectFailure(
        await userAdmin.client.post('/api/user/update', {
          id: userAdmin.id,
          roles: [userAdminRole, 'admin'],
        }),
        403,
        'permission',
      );
      const me = expectSuccess(
        await admin.post('/api/user/info', { id: userAdmin.id }),
      );
      expect(me.roles).not.toContain('admin');
    });

    it('can not create admins', async () => {
      expectFailure(
        await userAdmin.client.post('/api/user/create', {
          username: uniqueName(),
          password: 'correct-horse',
          roles: ['admin'],
        }),
        403,
        'permission',
      );
    });

    it('can not delete users with more permissions', async () => {
      const otherAdmin = await createUser(admin, ['admin']);
      expectFailure(
        await userAdmin.client.post('/api/user/delete', { id: otherAdmin.id }),
        403,
        'permission',
      );
      expectSuccess(await admin.post('/api/user/info', { id: otherAdmin.id }));
    });

    it('can still manage ordinary users', async () => {
      const viewerRole = await createRole(admin, ['image-view']);
      const created = expectSuccess(
        await userAdmin.client.post('/api/user/create', {
          username: uniqueName(),
          password: 'correct-horse',
          roles: [viewerRole],
        }),
      );
      expect(created.roles.sort()).toEqual([viewerRole, 'user'].sort());

      expectSuccess(
        await userAdmin.client.post('/api/user/update', {
          id: created.id,
          password: 'another-horse',
          roles: [],
        }),
      );
      await Client.user(created.username, 'another-horse');

      expectSuccess(
        await userAdmin.client.post('/api/user/delete', { id: created.id }),
      );
    });

    it('can give out roles they have themselves', async () => {
      const user = await createUser(admin);
      const updated = expectSuccess(
        await userAdmin.client.post('/api/user/update', {
          id: user.id,
          roles: [userAdminRole],
        }),
      );
      expect(updated.roles).toContain(userAdminRole);
    });
  });

  describe('role administrators', () => {
    let roleAdminRole: string;
    let roleAdmin: Client;

    beforeAll(async () => {
      roleAdminRole = await createRole(admin, ['role-admin']);
      roleAdmin = (await createUser(admin, [roleAdminRole])).client;
    });

    it('can not add permissions they do not have to their own role', async () => {
      expectFailure(
        await roleAdmin.post('/api/roles/update', {
          name: roleAdminRole,
          permissions: ['role-admin', 'syspref-admin'],
        }),
        403,
        'permission',
      );
      const role = expectSuccess(
        await admin.post('/api/roles/info', { name: roleAdminRole }),
      );
      expect(role.permissions).toEqual(['role-admin']);
    });

    it('can not give the user role more permissions than they have', async () => {
      const before = expectSuccess(
        await admin.post('/api/roles/info', { name: 'user' }),
      );
      expectFailure(
        await roleAdmin.post('/api/roles/update', {
          name: 'user',
          permissions: [...before.permissions, 'user-admin'],
        }),
        403,
        'permission',
      );
    });

    it('can not create roles with permissions they do not have', async () => {
      expectFailure(
        await roleAdmin.post('/api/roles/create', {
          name: roleName(),
          permissions: ['user-admin'],
        }),
        403,
        'permission',
      );
    });

    it('can not change or delete roles with more permissions', async () => {
      const powerful = await createRole(admin, ['syspref-admin']);
      expectFailure(
        await roleAdmin.post('/api/roles/update', {
          name: powerful,
          permissions: ['image-view'],
        }),
        403,
        'permission',
      );
      expectFailure(
        await roleAdmin.post('/api/roles/delete', { name: powerful }),
        403,
        'permission',
      );
    });

    it('can still manage roles within their own permissions', async () => {
      const name = roleName();
      expectSuccess(
        await roleAdmin.post('/api/roles/create', {
          name,
          permissions: ['image-view'],
        }),
      );
      expectSuccess(
        await roleAdmin.post('/api/roles/update', {
          name,
          permissions: ['image-view', 'image-upload'],
        }),
      );
      expectSuccess(await roleAdmin.post('/api/roles/delete', { name }));
    });
  });

  describe('api key administrators', () => {
    it('see the keys of others, but not the keys themselves', async () => {
      const keyAdminRole = await createRole(admin, ['apikey-admin']);
      const keyAdmin = await createUser(admin, [keyAdminRole]);
      const adminKey = expectSuccess(await admin.post('/api/apikeys/create'));
      const ownKey = expectSuccess(
        await keyAdmin.client.post('/api/apikeys/create'),
      );

      const info = expectSuccess(
        await keyAdmin.client.post('/api/apikeys/info', { id: adminKey.id }),
      );
      expect(info.user).toBe(adminId);
      expect(info.key).toBe('');

      const list = expectSuccess(
        await keyAdmin.client.post('/api/apikeys/list', {
          count: 100,
          page: 0,
        }),
      );
      const byId = new Map(list.results.map((k: any) => [k.id, k]));
      expect(byId.get(adminKey.id)).toMatchObject({ key: '' });
      expect(byId.get(ownKey.id)).toMatchObject({ key: ownKey.key });

      const renamed = expectSuccess(
        await keyAdmin.client.post('/api/apikeys/update', {
          id: adminKey.id,
          name: 'renamed',
        }),
      );
      expect(renamed.key).toBe('');

      const deleted = expectSuccess(
        await keyAdmin.client.post('/api/apikeys/delete', { id: adminKey.id }),
      );
      expect(deleted.key).toBe('');
    });
  });
});
