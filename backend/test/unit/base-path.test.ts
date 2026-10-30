import { describe, expect, it } from 'vitest';
import { ParseBasePath, StripBasePath } from '../../src/config/base-path.js';
import { WithBasePath } from '../../src/layers/http/frontend.js';

describe('serving Picsur under a path of its own', () => {
  it('reads the base path in any of its usual forms', () => {
    for (const value of [undefined, '', ' ', '/', '//']) {
      expect(ParseBasePath(value), String(value)).toBe('');
    }
    for (const value of ['/picsur', '/picsur/', 'picsur', ' /picsur ']) {
      expect(ParseBasePath(value), value).toBe('/picsur');
    }
    expect(ParseBasePath('/apps/picsur-2.0_~/')).toBe('/apps/picsur-2.0_~');
  });

  it('only accepts plain paths', () => {
    for (const value of [
      '/a//b',
      '/../picsur',
      '/picsur/.',
      '/pic sur',
      '/picsur?x=1',
      '/picsur#top',
      '/%2e%2e',
      'https://example.com/picsur',
      '/"><script>',
      '/api',
      '/api/picsur',
      '/i/',
      '/assets/photos',
      '/media',
    ]) {
      expect(() => ParseBasePath(value), value).toThrow(/PICSUR_BASE_PATH/);
    }
  });

  it('takes the base path off requests that have it', () => {
    const base = '/picsur';
    expect(StripBasePath('/picsur', base)).toBe('/');
    expect(StripBasePath('/picsur/', base)).toBe('/');
    expect(StripBasePath('/picsur?local', base)).toBe('/?local');
    expect(StripBasePath('/picsur/api/info', base)).toBe('/api/info');
    expect(StripBasePath('/picsur/user/login?local', base)).toBe(
      '/user/login?local',
    );
    // Proxies that take it off themselves
    expect(StripBasePath('/api/info', base)).toBe('/api/info');
    expect(StripBasePath('/', base)).toBe('/');
    // Other paths that start the same
    expect(StripBasePath('/picsurfoo/api/info', base)).toBe(
      '/picsurfoo/api/info',
    );
    // Without a base path nothing changes
    expect(StripBasePath('/picsur/api/info', '')).toBe('/picsur/api/info');
  });

  it('sets the base of the page', () => {
    const page = '<head><base href="/"/><script src="main.js"></script>';
    expect(WithBasePath(page, '/picsur')).toBe(
      '<head><base href="/picsur/"/><script src="main.js"></script>',
    );
    expect(WithBasePath(page, '')).toBe(page);
  });
});
