import * as client from 'openid-client';
import { AsyncFailable, Fail, FT } from 'picsur-shared/dist/types/failable';
import { OidcConfig } from '../../config/early/login.config.service.js';

// Seconds to wait for the provider
const Timeout = 15;

// Clients authenticate with HTTP Basic, the default of the specification and
// what providers like Authelia expect unless set up otherwise. Only with
// providers that cannot do that, the secret goes in the request body.
function ClientAuthentication(secret: string | undefined): client.ClientAuth {
  if (!secret) return client.None();
  const basic = client.ClientSecretBasic(secret);
  const post = client.ClientSecretPost(secret);
  return (as, ...rest) => {
    const supported = as.token_endpoint_auth_methods_supported;
    const usePost =
      supported !== undefined &&
      !supported.includes('client_secret_basic') &&
      supported.includes('client_secret_post');
    return (usePost ? post : basic)(as, ...rest);
  };
}

// Finds out the endpoints and keys of the provider, from its issuer or the url
// of its discovery document. Providers on plain http are allowed, for setups
// in a local network.
export async function DiscoverOidc(
  config: OidcConfig,
): Promise<client.Configuration> {
  const insecure = new URL(config.issuer).protocol === 'http:';
  return client.discovery(
    new URL(config.issuer),
    config.clientId,
    undefined,
    ClientAuthentication(config.clientSecret),
    {
      timeout: Timeout,
      execute: insecure ? [client.allowInsecureRequests] : [],
    },
  );
}

// Tries to discover the provider, and says what is wrong when that fails
export async function TestOidc(
  config: OidcConfig,
): AsyncFailable<{ issuer: string }> {
  try {
    const discovered = await DiscoverOidc(config);
    return { issuer: discovered.serverMetadata().issuer };
  } catch (e) {
    return Fail(FT.BadRequest, DescribeOidcError(e, config.issuer), e);
  }
}

// What went wrong talking to the provider, in words an admin can act on
export function DescribeOidcError(e: unknown, issuer: string): string {
  if (e instanceof client.ClientError) {
    const cause = e.cause as any;
    if (
      cause?.attribute === 'issuer' &&
      typeof cause?.body?.issuer === 'string'
    ) {
      return `The provider says its issuer is "${cause.body.issuer}", use exactly that`;
    }
  }
  const error = e as any;
  if (error?.name === 'TimeoutError' || error?.cause?.name === 'TimeoutError') {
    return `The provider at ${issuer} did not answer in time`;
  }
  const code = error?.cause?.code ?? error?.code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return `Could not find ${new URL(issuer).hostname}`;
  }
  if (code === 'ECONNREFUSED') {
    return `Could not connect to ${new URL(issuer).host}`;
  }
  if (typeof code === 'string' && code.startsWith('ERR_TLS')) {
    return `The certificate of ${new URL(issuer).host} is not valid`;
  }
  if (e instanceof client.ResponseBodyError) {
    return `The provider refused: ${e.error_description ?? e.error}`;
  }
  // Fetch only says it failed, the cause says why
  const message = error?.cause?.message ?? error?.message ?? String(e);
  return `Could not use the provider at ${issuer}: ${message}`;
}

// Usernames here are 4 to 32 letters and digits. New users get theirs from the
// claim set for it, or from other claims most providers have.
export function UsernameFromClaims(
  claims: Record<string, unknown>,
  claim: string,
): string {
  const email = claims['email'];
  const candidates = [
    claims[claim],
    claims['preferred_username'],
    typeof email === 'string' ? email.split('@')[0] : undefined,
    claims['nickname'],
    claims['name'],
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    // Letters with accents lose them, anything else that is not allowed goes
    const name = candidate
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9]/g, '')
      .slice(0, 32);
    if (name.length >= 4) return name;
    if (name.length > 0) return name + 'user';
  }
  return 'user';
}

// The username, or that with the lowest number after it that is not taken
export async function FreeUsername(
  base: string,
  taken: (username: string) => Promise<boolean>,
): Promise<string | null> {
  if (!(await taken(base))) return base;
  for (let i = 2; i < 1000; i++) {
    const suffix = String(i);
    const name = base.slice(0, 32 - suffix.length) + suffix;
    if (!(await taken(name))) return name;
  }
  return null;
}
