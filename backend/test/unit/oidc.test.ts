import { ServerSetting } from 'picsur-shared/dist/dto/server-settings.dto';
import { describe, expect, it } from 'vitest';
import { BuildLoginConfig } from '../../src/config/early/login.config.service.js';
import {
  FreeUsername,
  UsernameFromClaims,
} from '../../src/managers/auth/oidc.js';

describe('usernames of new users', () => {
  it('come from the claim set for it, or others', () => {
    expect(
      UsernameFromClaims({ uid: 'jdoe', preferred_username: 'x' }, 'uid'),
    ).toBe('jdoe');
    expect(UsernameFromClaims({ preferred_username: 'jane' }, 'uid')).toBe(
      'jane',
    );
    expect(UsernameFromClaims({ email: 'jane.doe@example.com' }, 'uid')).toBe(
      'janedoe',
    );
    expect(UsernameFromClaims({ name: 'Jane Doe' }, 'uid')).toBe('JaneDoe');
    expect(UsernameFromClaims({}, 'uid')).toBe('user');
  });

  it('only have letters and digits, 4 to 32 of them', () => {
    expect(UsernameFromClaims({ preferred_username: 'Zoë-Ann' }, 'x')).toBe(
      'ZoeAnn',
    );
    expect(UsernameFromClaims({ preferred_username: 'al' }, 'x')).toBe(
      'aluser',
    );
    expect(
      UsernameFromClaims({ preferred_username: 'a'.repeat(40) }, 'x'),
    ).toBe('a'.repeat(32));
    // Names without anything usable are skipped
    expect(
      UsernameFromClaims(
        { preferred_username: '山田', email: 'yamada@x.jp' },
        'x',
      ),
    ).toBe('yamada');
  });

  it('get a number when they are taken', async () => {
    const taken = new Set(['jane', 'jane2', 'a'.repeat(32)]);
    const isTaken = async (name: string) => taken.has(name);
    expect(await FreeUsername('june', isTaken)).toBe('june');
    expect(await FreeUsername('jane', isTaken)).toBe('jane3');
    // Without getting longer than 32
    expect(await FreeUsername('a'.repeat(32), isTaken)).toBe(
      'a'.repeat(31) + '2',
    );
  });
});

describe('login settings', () => {
  const settings = (values: Partial<Record<ServerSetting, string>>) =>
    BuildLoginConfig((key) => values[key]);

  it('only set up a provider with an issuer and a client id', () => {
    expect(settings({}).config).toEqual({ password: true, oidc: null });

    const half = settings({ [ServerSetting.OidcIssuer]: 'https://auth.test' });
    expect(half.config.oidc).toBeNull();
    expect(half.problem).toContain('PICSUR_OIDC_CLIENT_ID');

    const { config, problem } = settings({
      [ServerSetting.OidcIssuer]: 'https://auth.test',
      [ServerSetting.OidcClientId]: 'picsur',
    });
    expect(problem).toBeNull();
    expect(config.oidc).toEqual({
      issuer: 'https://auth.test',
      clientId: 'picsur',
      clientSecret: undefined,
      scope: 'openid profile email',
      name: 'single sign-on',
      usernameClaim: 'preferred_username',
      autoRegister: false,
      autoLaunch: false,
    });
  });

  it('keep password login on without a provider', () => {
    const off = settings({ [ServerSetting.PasswordLogin]: 'false' });
    expect(off.config.password).toBe(true);
    expect(off.problem).toContain('PICSUR_PASSWORD_LOGIN');

    const withProvider = settings({
      [ServerSetting.PasswordLogin]: 'false',
      [ServerSetting.OidcIssuer]: 'https://auth.test',
      [ServerSetting.OidcClientId]: 'picsur',
    });
    expect(withProvider.config.password).toBe(false);
    expect(withProvider.problem).toBeNull();
  });
});
