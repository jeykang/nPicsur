import { beforeAll, describe, expect, it } from 'vitest';
import {
  Client,
  createUser,
  expectFailure,
  expectSuccess,
  uniqueName,
} from './helpers/client.js';

describe('user management', () => {
  let admin: Client;

  beforeAll(async () => {
    admin = await Client.admin();
  });

  it('creates, reads, updates and deletes a user', async () => {
    const username = uniqueName();
    const created = expectSuccess(
      await admin.post('/api/user/create', {
        username,
        password: 'first-password',
        roles: [],
      }),
    );
    expect(created.username).toBe(username);
    expect(created.roles).toEqual(['user']);
    expect(created).not.toHaveProperty('hashed_password');

    const info = expectSuccess(
      await admin.post('/api/user/info', { id: created.id }),
    );
    expect(info.username).toBe(username);

    // Change the password, the old one must stop working
    expectSuccess(
      await admin.post('/api/user/update', {
        id: created.id,
        password: 'second-password',
      }),
    );
    await expect(Client.user(username, 'first-password')).rejects.toThrow();
    await Client.user(username, 'second-password');

    const deleted = expectSuccess(
      await admin.post('/api/user/delete', { id: created.id }),
    );
    expect(deleted.username).toBe(username);

    expectFailure(
      await admin.post('/api/user/info', { id: created.id }),
      404,
      'notfound',
    );
  });

  it('refuses duplicate usernames', async () => {
    const { username } = await createUser(admin);
    const res = await admin.post('/api/user/create', {
      username,
      password: 'correct-horse',
      roles: [],
    });
    expectFailure(res, 409, 'conflict');
  });

  it('validates usernames', async () => {
    const res = await admin.post('/api/user/create', {
      username: 'no spaces allowed',
      password: 'correct-horse',
      roles: [],
    });
    expectFailure(res, 400, 'usrvalidation');
  });

  it('lists users', async () => {
    await createUser(admin);
    const list = expectSuccess(
      await admin.post('/api/user/list', { count: 100, page: 0 }),
    );
    expect(list.total).toBeGreaterThanOrEqual(3);
    const names = list.results.map((u: any) => u.username);
    expect(names).toEqual(expect.arrayContaining(['admin', 'guest']));
    for (const user of list.results) {
      expect(user).not.toHaveProperty('hashed_password');
    }
  });

  it('protects the system users', async () => {
    const list = expectSuccess(
      await admin.post('/api/user/list', { count: 100, page: 0 }),
    );
    const adminUser = list.results.find((u: any) => u.username === 'admin');
    const guestUser = list.results.find((u: any) => u.username === 'guest');

    expectFailure(
      await admin.post('/api/user/delete', { id: adminUser.id }),
      403,
      'permission',
    );
    expectFailure(
      await admin.post('/api/user/delete', { id: guestUser.id }),
      403,
      'permission',
    );

    // The admin can not be demoted
    const updated = expectSuccess(
      await admin.post('/api/user/update', { id: adminUser.id, roles: [] }),
    );
    expect(updated.roles).toEqual(expect.arrayContaining(['admin']));

    const special = expectSuccess(await admin.get('/api/user/special'));
    expect(special.UndeletableUsersList).toEqual(['guest', 'admin']);
  });

  it('assigns roles but keeps soulbound ones', async () => {
    const { id } = await createUser(admin);
    const updated = expectSuccess(
      await admin.post('/api/user/update', { id, roles: ['admin'] }),
    );
    expect(updated.roles).toEqual(expect.arrayContaining(['user', 'admin']));

    // "guest" can never be added to a user
    const again = expectSuccess(
      await admin.post('/api/user/update', { id, roles: ['guest'] }),
    );
    expect(again.roles).toEqual(['user']);
  });

  it('is off limits to normal users', async () => {
    const { client } = await createUser(admin);
    expectFailure(
      await client.post('/api/user/list', { count: 10, page: 0 }),
      403,
      'permission',
    );
    expectFailure(
      await client.post('/api/user/create', {
        username: uniqueName(),
        password: 'correct-horse',
        roles: ['admin'],
      }),
      403,
      'permission',
    );
    expectFailure(
      await Client.guest().post('/api/user/list', { count: 10, page: 0 }),
      403,
      'permission',
    );
  });
});
