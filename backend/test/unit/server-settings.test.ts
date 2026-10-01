import { ServerSetting } from 'picsur-shared/dist/dto/server-settings.dto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GetServerSetting,
  GetServerSettingBool,
  GetServerSettingDuration,
  GetServerSettingNumber,
  ServerSettingResolver,
  UseSavedServerSettings,
  UseStoredServerSettings,
  WithLiveServerSettings,
} from '../../src/config/server-settings.js';

describe('server settings', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    UseStoredServerSettings(new Map());
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

  it('take yes, no, 1 and 0 from the environment for true and false', () => {
    const resolve = ServerSettingResolver(new Map());
    for (const [env, value] of [
      ['yes', 'true'],
      ['1', 'true'],
      ['no', 'false'],
      ['0', 'false'],
      ['true', 'true'],
      ['maybe', 'maybe'],
    ]) {
      vi.stubEnv('PICSUR_VERBOSE', env);
      expect(resolve(ServerSetting.Verbose)).toBe(value);
    }
    // Only for settings that are true or false
    vi.stubEnv('PICSUR_TRUST_PROXY', '1');
    expect(resolve(ServerSetting.TrustProxy)).toBe('1');
  });

  it('fall back to their default when the environment is not valid', () => {
    vi.stubEnv('PICSUR_BCRYPT_STRENGTH', '40');
    vi.stubEnv('PICSUR_VERBOSE', 'maybe');
    vi.stubEnv('PICSUR_CONVERSION_TIME_LIMIT', 'soon');
    expect(GetServerSettingNumber(ServerSetting.BCryptStrength)).toBe(10);
    expect(GetServerSettingBool(ServerSetting.Verbose)).toBe(false);
    expect(GetServerSettingDuration(ServerSetting.ConversionTimeLimit)).toBe(
      15_000,
    );

    vi.stubEnv('PICSUR_CONVERSION_TIME_LIMIT', '1m');
    expect(GetServerSettingDuration(ServerSetting.ConversionTimeLimit)).toBe(
      60_000,
    );
  });

  it('take effect right away when saved, or when Picsur restarts', () => {
    UseStoredServerSettings(new Map([[size, '2000']]));
    UseSavedServerSettings(
      new Map([
        [size, '3000'],
        [ServerSetting.AllowEditing, 'false'],
      ]),
    );
    // Read when Picsur starts
    expect(GetServerSetting(size)).toBe('2000');
    // Read when used
    expect(GetServerSettingBool(ServerSetting.AllowEditing)).toBe(false);
  });

  it('keep those that took effect when going back to earlier ones', () => {
    const earlier = new Map([
      [size, '2000'],
      [ServerSetting.AllowEditing, 'false'],
      [ServerSetting.HostOverride, 'https://old.example.com'],
    ]);
    const current = new Map([
      [size, '3000'],
      [ServerSetting.AllowEditing, 'true'],
    ]);
    expect(WithLiveServerSettings(earlier, current)).toEqual(
      new Map([
        [size, '2000'],
        [ServerSetting.AllowEditing, 'true'],
      ]),
    );
  });
});
