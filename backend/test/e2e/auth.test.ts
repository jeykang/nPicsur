import { describe, expect, it } from 'vitest';
import {
  Client,
  createUser,
  expectFailure,
  expectSuccess,
} from './helpers/client.js';

describe('authentication', () => {
  it('logs in the admin user', async () => {
    const admin = await Client.admin();
    expect(admin.jwt).toBeTypeOf('string');

    const me = expectSuccess(await admin.get('/api/user/me'));
    expect(me.user.username).toBe('admin');
    expect(me.user.roles).toEqual(expect.arrayContaining(['admin', 'user']));
    expect(me.user).not.toHaveProperty('hashed_password');
    expect(me.token).toBeTypeOf('string');
  });

  it('rejects a wrong password', async () => {
    const res = await Client.guest().post('/api/user/login', {
      username: 'admin',
      password: 'definitely-wrong',
    });
    expect(res.json.success).toBe(false);
    expect(res.json.data.type).toBe('authentication');
  });

  it('rejects an unknown user with the same message', async () => {
    const res = await Client.guest().post('/api/user/login', {
      username: 'nosuchuser',
      password: 'definitely-wrong',
    });
    expect(res.json.success).toBe(false);
    expect(res.json.data.type).toBe('authentication');
    expect(res.json.data.message).toBe('Wrong username or password');
  });

  it('never lets anyone log in as guest', async () => {
    const res = await Client.guest().post('/api/user/login', {
      username: 'guest',
      password: 'whatever-it-is',
    });
    expect(res.json.success).toBe(false);
  });

  it('validates the login body', async () => {
    const res = await Client.guest().post('/api/user/login', {
      username: 'x',
    });
    expect(res.json.success).toBe(false);
  });

  it('treats anonymous requests as the guest user', async () => {
    const guest = Client.guest();
    const perms = expectSuccess(await guest.get('/api/user/me/permissions'));
    expect(perms.permissions).toEqual(
      expect.arrayContaining(['image-view', 'user-login']),
    );
    expect(perms.permissions).not.toContain('image-upload');

    // Guests may not see their own "account"
    expectFailure(await guest.get('/api/user/me'), 403, 'permission');
  });

  it('falls back to guest for an invalid token', async () => {
    const client = Client.guest();
    client.jwt = 'not.a.jwt';
    const perms = expectSuccess(await client.get('/api/user/me/permissions'));
    expect(perms.permissions).not.toContain('image-upload');
  });

  it('keeps working with the refreshed token from /me', async () => {
    const admin = await Client.admin();
    const { token } = expectSuccess(await admin.get('/api/user/me'));
    const client = Client.guest();
    client.jwt = token;
    const me = expectSuccess(await client.get('/api/user/me'));
    expect(me.user.username).toBe('admin');
  });

  it('gives new users the default user role', async () => {
    const admin = await Client.admin();
    const { client } = await createUser(admin);
    const perms = expectSuccess(await client.get('/api/user/me/permissions'));
    expect(perms.permissions).toEqual(
      expect.arrayContaining(['image-upload', 'image-manage', 'apikey']),
    );
    expect(perms.permissions).not.toContain('user-admin');
  });

  it('checks the login permission of the user logging in', async () => {
    const admin = await Client.admin();
    const { username, password } = await createUser(admin);
    const userRole = expectSuccess(
      await admin.post('/api/roles/info', { name: 'user' }),
    );
    expect(userRole.permissions).toContain('user-login');

    expectSuccess(
      await admin.post('/api/roles/update', {
        name: 'user',
        permissions: userRole.permissions.filter(
          (p: string) => p !== 'user-login',
        ),
      }),
    );
    try {
      const res = await Client.guest().post('/api/user/login', {
        username,
        password,
      });
      expect(res.json.success).toBe(false);
      expect(res.json.data.type).toBe('permission');
    } finally {
      expectSuccess(
        await admin.post('/api/roles/update', {
          name: 'user',
          permissions: userRole.permissions,
        }),
      );
    }
    await Client.user(username, password);
  });

  it('does not allow registration by default', async () => {
    const res = await Client.guest().post('/api/user/register', {
      username: 'newperson',
      password: 'correct-horse',
    });
    expectFailure(res, 403, 'permission');
  });
});
