import {
  createServer,
  IncomingMessage,
  Server,
  ServerResponse,
} from 'node:http';
import { AddressInfo } from 'node:net';
import Provider from 'oidc-provider';

// A user at the test provider
export interface TestAccount {
  sub: string;
  preferred_username?: string;
  email?: string;
  name?: string;
}

export const TestClientId = 'picsur';
export const TestClientSecret = 'picsur-test-secret';

// An OpenID Connect provider for the tests, run by panva's oidc-provider, a
// certified implementation. Whoever is set as next logs in, without a login
// page. Like Authelia, it only puts who the user is in the ID token, the rest
// is at the userinfo endpoint, and it requires PKCE and HTTP Basic client
// authentication.
export class TestOidcProvider {
  // Who logs in next
  public next: TestAccount | null = null;
  private readonly accounts = new Map<string, TestAccount>();

  private constructor(
    public readonly issuer: string,
    private readonly server: Server,
  ) {}

  static async start(redirectUri: string): Promise<TestOidcProvider> {
    const server = createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const port = (server.address() as AddressInfo).port;
    const issuer = `http://127.0.0.1:${port}`;
    const test = new TestOidcProvider(issuer, server);

    const provider = new Provider(issuer, {
      clients: [
        {
          client_id: TestClientId,
          client_secret: TestClientSecret,
          redirect_uris: [redirectUri],
          token_endpoint_auth_method: 'client_secret_basic',
          grant_types: ['authorization_code'],
          response_types: ['code'],
        },
      ],
      pkce: { required: () => true },
      claims: {
        openid: ['sub'],
        profile: ['preferred_username', 'name'],
        email: ['email'],
      },
      features: { devInteractions: { enabled: false } },
      cookies: { keys: ['picsur-test-cookies'] },
      async findAccount(_ctx: unknown, sub: string) {
        const account = test.accounts.get(sub);
        if (account === undefined) return undefined;
        return { accountId: sub, claims: async () => ({ ...account }) };
      },
      // Every scope is granted without asking
      async loadExistingGrant(ctx: any) {
        const grantId =
          ctx.oidc.result?.consent?.grantId ||
          ctx.oidc.session.grantIdFor(ctx.oidc.client.clientId);
        if (grantId) return ctx.oidc.provider.Grant.find(grantId);
        const grant = new ctx.oidc.provider.Grant({
          clientId: ctx.oidc.client.clientId,
          accountId: ctx.oidc.session.accountId,
        });
        grant.addOIDCScope('openid profile email');
        await grant.save();
        return grant;
      },
    });

    const callback = provider.callback();
    server.on('request', (req: IncomingMessage, res: ServerResponse) => {
      if (!req.url?.startsWith('/interaction/')) return callback(req, res);
      // The login page, which logs in whoever is next right away
      void (async () => {
        try {
          await provider.interactionDetails(req, res);
          const account = test.next;
          if (account === null) {
            res.statusCode = 400;
            res.end('Nobody is set to log in');
            return;
          }
          test.accounts.set(account.sub, account);
          await provider.interactionFinished(
            req,
            res,
            { login: { accountId: account.sub } },
            { mergeWithLastSubmission: false },
          );
        } catch (e) {
          res.statusCode = 500;
          res.end(String(e));
        }
      })();
    });

    return test;
  }

  async stop() {
    this.server.closeAllConnections();
    await new Promise((resolve) => this.server.close(resolve));
  }
}

// Goes to the provider like a browser does, logs in there, and returns the url
// it sends the browser back to
export async function LoginAtProvider(
  authorizationUrl: string,
  redirectUri: string,
): Promise<string> {
  // The provider's own cookies
  const cookies = new Map<string, string>();
  let url = authorizationUrl;
  for (let i = 0; i < 20; i++) {
    if (url.startsWith(redirectUri)) return url;
    const res = await fetch(url, {
      redirect: 'manual',
      headers: {
        cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
      },
    });
    for (const header of res.headers.getSetCookie()) {
      const [pair] = header.split(';');
      const [name, ...value] = pair.split('=');
      if (/max-age=0|expires=thu, 01 jan 1970/i.test(header)) {
        cookies.delete(name);
      } else {
        cookies.set(name, value.join('='));
      }
    }
    const location = res.headers.get('location');
    if (location === null) {
      throw new Error(
        `The provider stopped at ${url} with ${res.status}: ${await res.text()}`,
      );
    }
    url = new URL(location, url).href;
  }
  throw new Error('The provider redirected too often');
}
