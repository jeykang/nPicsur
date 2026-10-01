import { Injectable, Logger } from '@nestjs/common';
import { ServerSetting } from 'picsur-shared/dist/dto/server-settings.dto';
import { ParseBool } from 'picsur-shared/dist/util/parse-simple';
import { GetServerSetting, ServerSettingDefault } from '../server-settings.js';

// Logging in with an OpenID Connect provider, like Authelia, Authentik or
// Keycloak, as a client of it
export interface OidcConfig {
  // The issuer, or the url of its discovery document
  issuer: string;
  clientId: string;
  // Without one, the client is a public one, which only works with PKCE
  clientSecret?: string;
  scope: string;
  // Of the provider, the login button says "Log in with" it
  name: string;
  // The claim new users get their username from
  usernameClaim: string;
  // Whether someone without an account here gets one when they log in
  autoRegister: boolean;
  // Whether the login page goes to the provider right away
  autoLaunch: boolean;
}

export interface LoginConfig {
  // Whether users can log in with their username and password
  password: boolean;
  oidc: OidcConfig | null;
}

function setting(
  get: (key: ServerSetting) => string | undefined,
  key: ServerSetting,
): string {
  return get(key) ?? ServerSettingDefault(key) ?? '';
}

// Works out how users log in from the server settings. Password login can only
// be turned off when there is a provider, or nobody could log in at all.
export function BuildLoginConfig(
  get: (key: ServerSetting) => string | undefined,
): { config: LoginConfig; problem: string | null } {
  const issuer = get(ServerSetting.OidcIssuer);
  const clientId = get(ServerSetting.OidcClientId);

  let oidc: OidcConfig | null = null;
  let problem: string | null = null;
  if (issuer !== undefined && clientId !== undefined) {
    oidc = {
      issuer,
      clientId,
      clientSecret: get(ServerSetting.OidcClientSecret),
      scope: setting(get, ServerSetting.OidcScope),
      name: setting(get, ServerSetting.OidcName),
      usernameClaim: setting(get, ServerSetting.OidcUsernameClaim),
      autoRegister: ParseBool(
        setting(get, ServerSetting.OidcAutoRegister),
        false,
      ),
      autoLaunch: ParseBool(setting(get, ServerSetting.OidcAutoLaunch), false),
    };
  } else if (issuer !== undefined || clientId !== undefined) {
    problem =
      'Logging in with OpenID Connect needs both an issuer (PICSUR_OIDC_ISSUER) and a client id (PICSUR_OIDC_CLIENT_ID), it is off until both are set';
  }

  let password = ParseBool(setting(get, ServerSetting.PasswordLogin), true);
  if (!password && oidc === null) {
    password = true;
    problem ??=
      'Password login (PICSUR_PASSWORD_LOGIN) can only be turned off when logging in with OpenID Connect is set up, it stays on until then';
  }

  return { config: { password, oidc }, problem };
}

@Injectable()
export class LoginConfigService {
  private readonly logger = new Logger(LoginConfigService.name);
  private readonly config: LoginConfig;

  constructor() {
    const { config, problem } = BuildLoginConfig(GetServerSetting);
    this.config = config;

    if (problem !== null) this.logger.warn(problem);
    if (config.oidc !== null) {
      this.logger.log(
        `Logging in with OpenID Connect at ${config.oidc.issuer}`,
      );
    }
    if (!config.password) this.logger.log('Password login is turned off');
  }

  public get password(): boolean {
    return this.config.password;
  }

  public get oidc(): OidcConfig | null {
    return this.config.oidc;
  }
}
