import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  Client,
  createUser,
  expectFailure,
  expectSuccess,
} from './helpers/client.js';
import { cli } from './helpers/cli.js';
import {
  LoginAtProvider,
  TestAccount,
  TestClientId,
  TestClientSecret,
  TestOidcProvider,
} from './helpers/oidc-provider.js';
import { restart, update } from './helpers/settings.js';

const env = inject('serverEnv');
// Login settings from the environment would change what these tests expect
const loginFromEnv = Object.keys(env).some(
  (key) => key.startsWith('PICSUR_OIDC_') || key === 'PICSUR_PASSWORD_LOGIN',
);

interface LoginMethods {
  password: boolean;
  oidc: { provider: string; linked: boolean; name: string | null } | null;
}

describe.skipIf(loginFromEnv)('logging in with OpenID Connect', () => {
  const redirectUri = inject('baseUrl') + '/user/oidc';
  let provider: TestOidcProvider;
  // Logged in with a password, which keeps working when that is turned off
  let admin: Client;

  // Starts logging in, or linking a login for a client that is logged in.
  // Returns where to go at the provider, and the cookie for the callback.
  async function start(client: Client, path = '/api/user/oidc/login') {
    const res = await client.post(path);
    const { url } = expectSuccess<{ url: string }>(res);
    const cookie = res.headers
      .getSetCookie()
      .find((header) => header.startsWith('picsur_oidc='));
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    return { url, cookie: cookie!.split(';')[0] };
  }

  function finish(client: Client, cookie: string | null, url: string) {
    return client.post(
      '/api/user/oidc/callback',
      { url },
      { headers: cookie === null ? {} : { cookie } },
    );
  }

  // Logs in at the provider as the account, and finishes logging in here
  async function loginAs(account: TestAccount, client = Client.guest()) {
    provider.next = account;
    const { url, cookie } = await start(client);
    return finish(client, cookie, await LoginAtProvider(url, redirectUri));
  }

  async function loginOk(account: TestAccount): Promise<Client> {
    const { jwt_token } = expectSuccess(await loginAs(account));
    expect(jwt_token).toEqual(expect.any(String));
    const client = Client.guest();
    client.jwt = jwt_token;
    return client;
  }

  async function link(client: Client, account: TestAccount) {
    provider.next = account;
    const { url, cookie } = await start(client, '/api/user/me/oidc');
    return finish(client, cookie, await LoginAtProvider(url, redirectUri));
  }

  async function loginMethods(client: Client): Promise<LoginMethods> {
    return expectSuccess(await client.get('/api/user/me/login'));
  }

  async function username(client: Client): Promise<string> {
    return expectSuccess(await client.get('/api/user/me')).user.username;
  }

  beforeAll(async () => {
    provider = await TestOidcProvider.start(redirectUri);
    admin = await Client.admin();
  });

  afterAll(async () => {
    if (admin !== undefined) {
      expectSuccess(
        await update(admin, {
          password_login: null,
          oidc_issuer: null,
          oidc_client_id: null,
          oidc_client_secret: null,
          oidc_name: null,
          oidc_auto_register: null,
        }),
      );
      await restart(admin);
    }
    await provider?.stop();
  });

  it('is off until it is set up', async () => {
    const info = expectSuccess(await Client.guest().get('/api/info'));
    expect(info.login).toEqual({ password: true, oidc: null });
    expectFailure(await Client.guest().post('/api/user/oidc/login'), 404);
  });

  it('only saves a provider that can be reached', async () => {
    // A port nothing listens on
    const closed = createServer();
    await new Promise<void>((resolve) =>
      closed.listen(0, '127.0.0.1', resolve),
    );
    const port = (closed.address() as AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve));

    const unreachable = await update(admin, {
      oidc_issuer: `http://127.0.0.1:${port}/`,
      oidc_client_id: TestClientId,
    });
    expectFailure(unreachable, 400);
    expect(unreachable.json.data.message).toContain('Could not connect');

    // The issuer has to be exactly what the provider says it is
    const wrong = await admin.post('/api/server/settings/test-oidc', {
      values: {
        oidc_issuer: provider.issuer + '/somewhere',
        oidc_client_id: TestClientId,
      },
    });
    expectFailure(wrong, 400);

    const tested = await admin.post('/api/server/settings/test-oidc', {
      values: { oidc_issuer: provider.issuer, oidc_client_id: TestClientId },
    });
    expect(expectSuccess(tested).issuer).toBe(provider.issuer);

    // Only admins can try out providers
    const { client } = await createUser(admin);
    expectFailure(
      await client.post('/api/server/settings/test-oidc', { values: {} }),
      403,
    );
  });

  it('can be set up on the settings page', async () => {
    expectSuccess(
      await update(admin, {
        oidc_issuer: provider.issuer,
        oidc_client_id: TestClientId,
        oidc_client_secret: TestClientSecret,
        oidc_name: 'Test Provider',
      }),
    );
    await restart(admin);

    const info = expectSuccess(await Client.guest().get('/api/info'));
    expect(info.login).toEqual({
      password: true,
      oidc: { name: 'Test Provider', auto_launch: false },
    });
  });

  it('does not let someone without an account in', async () => {
    const res = await loginAs({ sub: 'stranger', preferred_username: 'who' });
    expectFailure(res, 403);
    expect(res.json.data.message).toContain('is not linked to an account here');
  });

  it('links a login to an account, which can then log in with it', async () => {
    const user = await createUser(admin);
    expect(await loginMethods(user.client)).toEqual({
      password: true,
      oidc: { provider: 'Test Provider', linked: false, name: null },
    });

    const linked = expectSuccess(
      await link(user.client, { sub: 'alice', preferred_username: 'alice' }),
    );
    expect(linked.jwt_token).toBeNull();
    expect(await loginMethods(user.client)).toEqual({
      password: true,
      oidc: { provider: 'Test Provider', linked: true, name: 'alice' },
    });

    const client = await loginOk({ sub: 'alice', preferred_username: 'al' });
    expect(await username(client)).toBe(user.username);
    // The provider's current name for the login is kept
    expect((await loginMethods(client)).oidc?.name).toBe('al');

    // A login is linked to one account only
    const other = await createUser(admin);
    expectFailure(await link(other.client, { sub: 'alice' }), 409);
  });

  it('only finishes a login in the browser that started it, once', async () => {
    provider.next = { sub: 'alice' };
    const first = await start(Client.guest());
    const back = await LoginAtProvider(first.url, redirectUri);

    // Without the cookie, or with the one of another login
    expectFailure(await finish(Client.guest(), null, back), 400);
    const second = await start(Client.guest());
    expectFailure(
      await finish(Client.guest(), second.cookie, back),
      200,
      'authentication',
    );

    // The login that was started can be finished once
    expectSuccess(await finish(Client.guest(), first.cookie, back));
    expectFailure(await finish(Client.guest(), first.cookie, back), 400);

    // Logins someone links are only finished by them
    const user = await createUser(admin);
    const other = await createUser(admin);
    provider.next = { sub: 'mallory' };
    const linking = await start(user.client, '/api/user/me/oidc');
    const linkBack = await LoginAtProvider(linking.url, redirectUri);
    expectFailure(await finish(other.client, linking.cookie, linkBack), 400);
  });

  it('does not let api keys link logins', async () => {
    const user = await createUser(admin);
    const key = expectSuccess(await user.client.post('/api/apikeys/create'));
    const withKey = Client.withApiKey(key.key);
    expectFailure(await withKey.post('/api/user/me/oidc'), 403);
  });

  describe('with new users registered', () => {
    beforeAll(async () => {
      expectSuccess(await update(admin, { oidc_auto_register: 'true' }));
      await restart(admin);
    });

    afterAll(async () => {
      expectSuccess(await update(admin, { oidc_auto_register: null }));
      await restart(admin);
    });

    it('creates an account named after the login', async () => {
      // The name is only at the userinfo endpoint, not in the ID token
      const bob = await loginOk({
        sub: 'bob',
        preferred_username: 'bob.smith',
      });
      expect(await username(bob)).toBe('bobsmith');
      expect(await loginMethods(bob)).toEqual({
        password: false,
        oidc: { provider: 'Test Provider', linked: true, name: 'bob.smith' },
      });

      // Names that are taken get a number, short ones a word
      const other = await loginOk({
        sub: 'bob2',
        preferred_username: 'Bob Smith',
      });
      expect(await username(other)).toBe('BobSmith');
      const third = await loginOk({
        sub: 'bob3',
        preferred_username: 'bob.smith',
      });
      expect(await username(third)).toBe('bobsmith2');
      const al = await loginOk({ sub: 'al', preferred_username: 'al' });
      expect(await username(al)).toBe('aluser');

      // Without a username, the email address will do
      const carol = await loginOk({ sub: 'carol', email: 'carol@example.com' });
      expect(await username(carol)).toBe('carol');

      // Logging in again finds the same account
      const again = await loginOk({ sub: 'bob' });
      expect(await username(again)).toBe('bobsmith');
    });

    it('lets users without a password set one', async () => {
      const dave = await loginOk({ sub: 'dave', preferred_username: 'dave' });
      const name = await username(dave);
      // There is no password to log in with yet, and none to unlink
      expectFailure(
        await Client.guest().post('/api/user/login', {
          username: name,
          password: 'anything',
        }),
        200,
        'authentication',
      );
      expectFailure(await dave.request('DELETE', '/api/user/me/oidc'), 409);

      const set = await dave.post('/api/user/me/password', {
        new_password: 'a-new-password',
      });
      dave.jwt = expectSuccess(set).jwt_token;
      await Client.user(name, 'a-new-password');

      // With a password, the current one is needed to change it
      expectFailure(
        await dave.post('/api/user/me/password', {
          new_password: 'another-password',
        }),
        200,
        'authentication',
      );

      // And the login can be unlinked
      const unlinked = expectSuccess<LoginMethods>(
        await dave.request('DELETE', '/api/user/me/oidc'),
      );
      expect(unlinked.oidc?.linked).toBe(false);
    });
  });

  describe('password login', () => {
    afterAll(async () => {
      expectSuccess(await update(admin, { password_login: null }));
      await restart(admin);
    });

    it('can only be turned off by someone who can log in otherwise', async () => {
      const res = await update(admin, { password_login: 'false' });
      expectFailure(res, 409);
      expect(res.json.data.message).toContain('Link your own account');
    });

    it('can be turned off, and only allows logins at the provider', async () => {
      expectSuccess(await link(admin, { sub: 'the-admin' }));
      expectSuccess(await update(admin, { password_login: 'false' }));
      await restart(admin);

      const info = expectSuccess(await Client.guest().get('/api/info'));
      expect(info.login.password).toBe(false);
      expectFailure(
        await Client.guest().post('/api/user/login', {
          username: 'admin',
          password: inject('adminPassword'),
        }),
        403,
      );
      expectFailure(
        await Client.guest().post('/api/user/register', {
          username: 'someoneelse',
          password: 'some-password',
        }),
        403,
      );

      const viaProvider = await loginOk({ sub: 'the-admin' });
      expect(await username(viaProvider)).toBe('admin');

      // Linked logins are of this provider, it cannot be changed now
      const res = await update(admin, {
        oidc_issuer: provider.issuer + '/.well-known/openid-configuration',
      });
      expectFailure(res, 409);

      // Nor can a login be unlinked, even with a password, as it is the only
      // way to log in now
      const unlink = await admin.request('DELETE', '/api/user/me/oidc');
      expectFailure(unlink, 409);
      expect(unlink.json.data.message).toContain('turned off');
      expect((await loginMethods(admin)).oidc?.linked).toBe(true);

      // The way back in when the provider is gone: removing the saved
      // setting on the command line, and restarting
      const reset = await cli(['settings', 'reset', 'password_login']);
      expect(reset.code, reset.output).toBe(0);
      expect(reset.output).toContain('the default (true) applies');
      await restart(admin);
      expect(
        expectSuccess(await Client.guest().get('/api/info')).login.password,
      ).toBe(true);
      await Client.admin();
    });
  });
});
