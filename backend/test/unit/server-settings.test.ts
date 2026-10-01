import { ServerSetting } from 'picsur-shared/dist/dto/server-settings.dto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerSettingResolver } from '../../src/config/server-settings.js';

describe('server settings', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const size = ServerSetting.MaxFileSize;

  it('are what is saved, before what the environment sets', () => {
    vi.stubEnv('PICSUR_MAX_FILE_SIZE', '1000');
    expect(ServerSettingResolver(new Map([[size, '2000']]))(size)).toBe('2000');
    expect(ServerSettingResolver(new Map())(size)).toBe('1000');
  });

  it('are not set by empty environment variables', () => {
    vi.stubEnv('PICSUR_MAX_FILE_SIZE', '  ');
    expect(ServerSettingResolver(new Map())(size)).toBeUndefined();
  });
});
