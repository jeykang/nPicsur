import { Body, Controller, Delete, Get, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  UserLoginMethodsResponse,
  UserOidcCallbackRequest,
  UserOidcCallbackResponse,
  UserOidcStartResponse,
} from 'picsur-shared/dist/dto/api/user.dto';
import {
  Fail,
  FT,
  HasFailed,
  ThrowIfFailed,
} from 'picsur-shared/dist/types/failable';
import { UserDbService } from '../../../collections/user-db/user-db.service.js';
import { InfoConfigService } from '../../../config/late/info.config.service.js';
import { EasyThrottle } from '../../../decorators/easy-throttle.decorator.js';
import {
  NoPermissions,
  RequiredPermissions,
} from '../../../decorators/permissions.decorator.js';
import { ReqUserID } from '../../../decorators/request-user.decorator.js';
import { Returns } from '../../../decorators/returns.decorator.js';
import { AuthManagerService } from '../../../managers/auth/auth.service.js';
import { ApiKeyPrefix } from '../../../managers/auth/guards/apikey.strategy.js';
import {
  OidcLoginLifetime,
  OidcService,
} from '../../../managers/auth/oidc.service.js';
import { Permission } from '../../../models/constants/permissions.const.js';
import { EUserBackend2EUser } from '../../../models/transformers/user.transformer.js';

// The browser keeps the id of the login it started in this cookie, which only
// the callback gets
const LoginCookie = 'picsur_oidc';
const LoginCookiePath = '/api/user/oidc';
// The page of the frontend the provider sends the browser back to
const CallbackPage = '/user/oidc';

function readCookie(req: FastifyRequest, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return undefined;
}

function setLoginCookie(req: FastifyRequest, reply: FastifyReply, id: string) {
  const secure = req.protocol === 'https' ? '; Secure' : '';
  const maxAge = id === '' ? 0 : OidcLoginLifetime / 1000;
  reply.header(
    'set-cookie',
    `${LoginCookie}=${id}; Path=${LoginCookiePath}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`,
  );
}

// Logging in with an OpenID Connect provider, and linking a login there to an
// account here
@Controller('api/user')
export class UserOidcController {
  constructor(
    private readonly oidc: OidcService,
    private readonly usersService: UserDbService,
    private readonly authService: AuthManagerService,
    private readonly infoConfig: InfoConfigService,
  ) {}

  @Post('oidc/login')
  @Returns(UserOidcStartResponse)
  @RequiredPermissions(Permission.UserLogin)
  @EasyThrottle(30, 300)
  async login(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<UserOidcStartResponse> {
    return this.start(req, reply, null);
  }

  @Post('me/oidc')
  @Returns(UserOidcStartResponse)
  @RequiredPermissions(Permission.UserKeepLogin)
  @EasyThrottle(10, 300)
  async link(
    @ReqUserID() userId: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<UserOidcStartResponse> {
    // A linked login gets session tokens, which api keys can not be
    // exchanged for
    if (req.headers.authorization?.startsWith(ApiKeyPrefix)) {
      throw Fail(FT.Permission, 'Log in to link a login');
    }
    return this.start(req, reply, userId);
  }

  // Called by the page the provider sent the browser back to. The cookie says
  // which login that is, the url what the provider answered.
  @Post('oidc/callback')
  @Returns(UserOidcCallbackResponse)
  @NoPermissions()
  @EasyThrottle(30, 300)
  async callback(
    @ReqUserID() requesterId: string,
    @Body() body: UserOidcCallbackRequest,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<UserOidcCallbackResponse> {
    const id = readCookie(req, LoginCookie);
    setLoginCookie(req, reply, '');

    const result = ThrowIfFailed(
      await this.oidc.finish(id, body.url, requesterId),
    );
    if (result.linked) return { jwt_token: null };
    const jwt_token = ThrowIfFailed(
      await this.authService.createToken(EUserBackend2EUser(result.user)),
    );
    return { jwt_token };
  }

  @Get('me/login')
  @Returns(UserLoginMethodsResponse)
  @RequiredPermissions(Permission.UserKeepLogin)
  async loginMethods(
    @ReqUserID() userId: string,
  ): Promise<UserLoginMethodsResponse> {
    const password = ThrowIfFailed(await this.usersService.hasPassword(userId));
    const config = this.oidc.config;
    if (config === null) return { password, oidc: null };

    const linked = await this.oidc.linkedLogin(userId);
    return {
      password,
      oidc: {
        provider: config.name,
        // When the provider can not be reached, this is not known
        linked: !HasFailed(linked) && linked !== null,
        name: HasFailed(linked) ? null : (linked?.name ?? null),
      },
    };
  }

  @Delete('me/oidc')
  @Returns(UserLoginMethodsResponse)
  @RequiredPermissions(Permission.UserKeepLogin)
  @EasyThrottle(10, 300)
  async unlink(@ReqUserID() userId: string): Promise<UserLoginMethodsResponse> {
    ThrowIfFailed(await this.oidc.unlink(userId));
    return this.loginMethods(userId);
  }

  private async start(
    req: FastifyRequest,
    reply: FastifyReply,
    userId: string | null,
  ): Promise<UserOidcStartResponse> {
    const started = ThrowIfFailed(
      await this.oidc.start(this.redirectUri(req), userId),
    );
    setLoginCookie(req, reply, started.id);
    return { url: started.url };
  }

  // Where the provider sends the browser back to, which has to be registered
  // with the provider. The public url when one is set in the settings,
  // otherwise the address the browser uses, as long as it is this server.
  private redirectUri(req: FastifyRequest): string {
    const hostOverride = this.infoConfig.getHostnameOverride();
    if (hostOverride !== undefined) {
      return new URL(hostOverride).origin + CallbackPage;
    }

    let base = `${req.protocol}://${req.host}`;
    const origin = req.headers.origin;
    if (origin !== undefined) {
      try {
        const url = new URL(origin);
        if (url.host === req.host) base = url.origin;
      } catch {
        // Not an url, the address of the request it is
      }
    }
    return base + CallbackPage;
  }
}
