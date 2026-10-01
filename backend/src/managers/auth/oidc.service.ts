import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import * as client from 'openid-client';
import {
  AsyncFailable,
  Fail,
  FT,
  HasFailed,
} from 'picsur-shared/dist/types/failable';
import { UserDbService } from '../../collections/user-db/user-db.service.js';
import { UserOidcDbService } from '../../collections/user-db/user-oidc-db.service.js';
import {
  LoginConfigService,
  OidcConfig,
} from '../../config/early/login.config.service.js';
import { EUserBackend } from '../../database/entities/users/user.entity.js';
import { Permission } from '../../models/constants/permissions.const.js';
import {
  DescribeOidcError,
  DiscoverOidc,
  FreeUsername,
  UsernameFromClaims,
} from './oidc.js';

// A login started here, that the provider sends the user back from
interface PendingLogin {
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
  // Who links their account, null for logging in
  userId: string | null;
  expires: number;
}

// How long a login at the provider may take
export const OidcLoginLifetime = 10 * 60 * 1000;
// Logins that were started are kept in memory, at most this many
const MaxPendingLogins = 10_000;

export type OidcResult =
  { linked: false; user: EUserBackend } | { linked: true; user: null };

// Logging in with an OpenID Connect provider, with the authorization code
// flow, PKCE, state and nonce. What the browser needs to finish a login is
// kept here, under a random id that the browser gets in a cookie, so only the
// browser that started a login can finish it.
@Injectable()
export class OidcService {
  private readonly logger = new Logger(OidcService.name);
  private readonly pending = new Map<string, PendingLogin>();
  private discovered: Promise<client.Configuration> | null = null;

  constructor(
    private readonly loginConfig: LoginConfigService,
    private readonly usersService: UserDbService,
    private readonly logins: UserOidcDbService,
  ) {}

  public get config(): OidcConfig | null {
    return this.loginConfig.oidc;
  }

  // The provider is discovered when it is first needed, and again after that
  // failed, so Picsur starts when the provider is down
  private async configuration(): AsyncFailable<client.Configuration> {
    const config = this.config;
    if (config === null) {
      return Fail(FT.NotFound, 'Logging in with OpenID Connect is not set up');
    }

    this.discovered ??= DiscoverOidc(config);
    try {
      return await this.discovered;
    } catch (e) {
      this.discovered = null;
      const reason = DescribeOidcError(e, config.issuer);
      this.logger.warn(reason);
      return Fail(
        FT.Internal,
        `Could not reach ${config.name}, try again later`,
        reason,
      );
    }
  }

  // Returns the url of the provider to send the browser to, and the id of
  // the login for the browser to keep
  public async start(
    redirectUri: string,
    userId: string | null,
  ): AsyncFailable<{ url: string; id: string }> {
    const configuration = await this.configuration();
    if (HasFailed(configuration)) return configuration;
    const config = this.config!;

    const login: PendingLogin = {
      state: client.randomState(),
      nonce: client.randomNonce(),
      codeVerifier: client.randomPKCECodeVerifier(),
      redirectUri,
      userId,
      expires: Date.now() + OidcLoginLifetime,
    };
    const url = client.buildAuthorizationUrl(configuration, {
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: config.scope,
      state: login.state,
      nonce: login.nonce,
      code_challenge: await client.calculatePKCECodeChallenge(
        login.codeVerifier,
      ),
      code_challenge_method: 'S256',
    });

    const id = randomBytes(32).toString('base64url');
    this.keep(id, login);
    return { url: url.href, id };
  }

  // Finishes the login with the id from the browser, and the url the provider
  // sent it back to. Logs the user in, or links the login to the user who
  // started it, who has to be the one finishing it.
  public async finish(
    id: string | undefined,
    callbackUrl: string,
    requesterId: string,
  ): AsyncFailable<OidcResult> {
    const login = id === undefined ? undefined : this.pending.get(id);
    // Each login can only be finished once
    if (id !== undefined) this.pending.delete(id);
    if (login === undefined || login.expires < Date.now()) {
      return Fail(
        FT.BadRequest,
        'This login has expired or was not started in this browser, try again',
      );
    }
    if (login.userId !== null && login.userId !== requesterId) {
      return Fail(
        FT.BadRequest,
        'This login was started by someone else, try again',
      );
    }

    const configuration = await this.configuration();
    if (HasFailed(configuration)) return configuration;
    const config = this.config!;

    // Only the answer of the provider is taken from the url, where it was sent
    // to is known here
    let current: URL;
    try {
      current = new URL(login.redirectUri);
      current.search = new URL(callbackUrl).search;
    } catch {
      return Fail(FT.UsrValidation, 'Invalid url');
    }

    let claims: Record<string, unknown>;
    try {
      const tokens = await client.authorizationCodeGrant(
        configuration,
        current,
        {
          pkceCodeVerifier: login.codeVerifier,
          expectedState: login.state,
          expectedNonce: login.nonce,
          idTokenExpected: true,
        },
      );
      const idToken = tokens.claims()!;
      claims = { ...idToken };
      // Many providers, like Authelia, only put who the user is in the ID
      // token, their name and email address are at the userinfo endpoint
      if (configuration.serverMetadata().userinfo_endpoint) {
        const info = await client.fetchUserInfo(
          configuration,
          tokens.access_token,
          idToken.sub,
        );
        claims = { ...info, ...idToken };
      }
    } catch (e) {
      if (e instanceof client.AuthorizationResponseError) {
        return Fail(
          FT.Permission,
          `${config.name} did not log you in: ${e.error_description ?? e.error}`,
          e,
        );
      }
      const reason = DescribeOidcError(e, config.issuer);
      this.logger.warn(`Logging in with OpenID Connect failed: ${reason}`);
      return Fail(
        FT.Authentication,
        `Logging in with ${config.name} failed`,
        e,
      );
    }

    const issuer = configuration.serverMetadata().issuer;
    const subject = String(claims['sub']);
    const name = this.displayName(claims);

    if (login.userId !== null) {
      return this.link(login.userId, issuer, subject, name);
    }
    return this.login(config, issuer, subject, name, claims);
  }

  public async unlink(userId: string): AsyncFailable<boolean> {
    const configuration = await this.configuration();
    if (HasFailed(configuration)) return configuration;

    // Without logging in with a password, there would be no way to log in
    // anymore
    if (!this.loginConfig.password) {
      return Fail(
        FT.Conflict,
        'Logging in with a password is turned off, so you could not log in anymore',
      );
    }
    const hasPassword = await this.usersService.hasPassword(userId);
    if (HasFailed(hasPassword)) return hasPassword;
    if (!hasPassword) {
      return Fail(
        FT.Conflict,
        'Set a password first, or you could not log in anymore',
      );
    }
    return this.logins.unlink(userId, configuration.serverMetadata().issuer);
  }

  // The login at the provider the user is linked to, if any
  public async linkedLogin(
    userId: string,
  ): AsyncFailable<{ name: string | null } | null> {
    const configuration = await this.configuration();
    if (HasFailed(configuration)) return configuration;
    const link = await this.logins.findForUser(
      userId,
      configuration.serverMetadata().issuer,
    );
    if (HasFailed(link)) return link;
    return link === null ? null : { name: link.name };
  }

  private async link(
    userId: string,
    issuer: string,
    subject: string,
    name: string | null,
  ): AsyncFailable<OidcResult> {
    const existing = await this.logins.findByLogin(issuer, subject);
    if (HasFailed(existing)) return existing;
    if (existing !== null) {
      if (existing.user_id === userId) return { linked: true, user: null };
      return Fail(
        FT.Conflict,
        'This account at the provider is linked to another account here already',
      );
    }

    const linked = await this.logins.link(userId, issuer, subject, name);
    if (HasFailed(linked)) return linked;
    this.logger.log(`Linked an account at ${issuer} to user ${userId}`);
    return { linked: true, user: null };
  }

  private async login(
    config: OidcConfig,
    issuer: string,
    subject: string,
    name: string | null,
    claims: Record<string, unknown>,
  ): AsyncFailable<OidcResult> {
    const existing = await this.logins.findByLogin(issuer, subject);
    if (HasFailed(existing)) return existing;

    let user: EUserBackend;
    if (existing !== null) {
      const found = await this.usersService.findOne(existing.user_id);
      if (HasFailed(found)) return found;
      user = found;
      await this.logins.loggedIn(existing.id, name);
    } else {
      if (!config.autoRegister) {
        return Fail(
          FT.Permission,
          `Your ${config.name} account is not linked to an account here. Log in with your password and link it under Settings → Account, or ask an administrator.`,
        );
      }
      const created = await this.register(
        config,
        issuer,
        subject,
        name,
        claims,
      );
      if (HasFailed(created)) return created;
      user = created;
    }

    // Like logging in with a password, the user has to be allowed to
    const permissions = await this.usersService.getPermissions(user.id);
    if (HasFailed(permissions)) return permissions;
    if (!permissions.includes(Permission.UserLogin)) {
      return Fail(FT.Permission, 'This user is not allowed to log in');
    }
    return { linked: false, user };
  }

  // A new user without a password, named after the login at the provider
  private async register(
    config: OidcConfig,
    issuer: string,
    subject: string,
    name: string | null,
    claims: Record<string, unknown>,
  ): AsyncFailable<EUserBackend> {
    const username = await FreeUsername(
      UsernameFromClaims(claims, config.usernameClaim),
      (username) => this.usersService.exists(username),
    );
    if (username === null) {
      return Fail(FT.Conflict, 'Could not find a free username');
    }

    const user = await this.usersService.create(username, null);
    if (HasFailed(user)) return user;
    const linked = await this.logins.link(user.id, issuer, subject, name);
    if (HasFailed(linked)) {
      await this.usersService.delete(user.id);
      return linked;
    }
    this.logger.log(
      `Created user "${username}" for a new account at ${config.name}`,
    );
    return user;
  }

  // What the provider calls the user, shown with the linked login
  private displayName(claims: Record<string, unknown>): string | null {
    for (const key of ['preferred_username', 'email', 'name']) {
      const value = claims[key];
      if (typeof value === 'string' && value !== '') return value.slice(0, 256);
    }
    return null;
  }

  private keep(id: string, login: PendingLogin) {
    const now = Date.now();
    for (const [key, value] of this.pending) {
      if (value.expires < now) this.pending.delete(key);
    }
    // The oldest logins go first, the map keeps them in order
    while (this.pending.size >= MaxPendingLogins) {
      this.pending.delete(this.pending.keys().next().value!);
    }
    this.pending.set(id, login);
  }
}
