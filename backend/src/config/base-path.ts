import { EnvPrefix } from './config.static.js';

const BasePathEnv = `${EnvPrefix}BASE_PATH`;

// Letters, digits and - . _ ~, the characters an address can hold as they are
const Segment = /^[A-Za-z0-9._~-]+$/;

// The path Picsur is served under, like /picsur, or '' when it is served at
// the root of its address. /picsur/ and picsur mean the same.
export function ParseBasePath(value: string | undefined): string {
  const trimmed = (value ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (trimmed === '') return '';

  const segments = trimmed.split('/');
  for (const segment of segments) {
    if (!Segment.test(segment) || segment === '.' || segment === '..') {
      throw new Error(
        `${BasePathEnv} must be a path like /picsur, not "${value}"`,
      );
    }
  }
  return '/' + segments.join('/');
}

let basePath: string | undefined;

// Set with PICSUR_BASE_PATH, it can only change when Picsur starts
export function BasePath(): string {
  basePath ??= ParseBasePath(process.env[BasePathEnv]);
  return basePath;
}

// Proxies either pass the base path on, or take it off themselves. Both
// reach the same routes, as requests without it are left as they are.
export function StripBasePath(url: string, base = BasePath()): string {
  if (base === '' || !url.startsWith(base)) return url;

  const rest = url.slice(base.length);
  if (rest === '' || rest.startsWith('?')) return '/' + rest;
  if (rest.startsWith('/')) return rest;
  // Only a part of the first segment, like /picsurfoo for /picsur
  return url;
}
