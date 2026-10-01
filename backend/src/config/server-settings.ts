import { Logger } from '@nestjs/common';
import { availableParallelism } from 'node:os';
import pg from 'pg';
import {
  BoolServerSettings,
  LiveServerSettings,
  ParseDuration,
  SecretServerSettings,
  ServerSetting,
  ServerSettingEnvName,
  ServerSettingList,
  ServerSettingValidators,
} from 'picsur-shared/dist/dto/server-settings.dto';
import { HasFailed } from 'picsur-shared/dist/types/failable';
import { ParseBool } from 'picsur-shared/dist/util/parse-simple';
import { ServerSettingsTable } from '../database/entities/system/server-setting.entity.js';
import { SystemStateTable } from '../database/entities/system/system-state.entity.js';
import { GetDbConnectionOptions } from './db-connection.js';
import {
  DecryptSetting,
  EncryptSetting,
  GeneratedKeyState,
  UseGeneratedEncryptionKey,
} from './settings-encryption.js';

// Server settings are what is saved on the settings page, stored in the
// database, and otherwise what the environment sets, and otherwise their
// default. Most are read when Picsur starts, so changes take effect on a
// restart. Those in LiveServerSettings take effect when they are saved.

export type StoredServerSettings = ReadonlyMap<ServerSetting, string>;

export const DefaultMaxFileSize = 128000000;
export const DefaultConversionRateLimit = 120;
export const DefaultS3Region = 'us-east-1';
// Loopback and private IPv4 addresses, which cover a reverse proxy in the
// same docker network
export const DefaultTrustProxy = [
  '127.0.0.0/8',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
];

// What is used when a setting is not set, null when it is simply left out
export function ServerSettingDefault(key: ServerSetting): string | null {
  switch (key) {
    case ServerSetting.StorageDriver:
      return 'database';
    case ServerSetting.S3Region:
      return DefaultS3Region;
    case ServerSetting.S3ForcePathStyle:
      return 'false';
    case ServerSetting.MaxFileSize:
      return String(DefaultMaxFileSize);
    case ServerSetting.MaxConcurrentConversions:
      return String(availableParallelism());
    case ServerSetting.ConversionRateLimit:
      return String(DefaultConversionRateLimit);
    case ServerSetting.ConversionTimeLimit:
      return '15s';
    case ServerSetting.ConversionMemoryLimit:
      return '512';
    case ServerSetting.AllowEditing:
      return 'true';
    case ServerSetting.RemoveDerivativesAfter:
      return '7d';
    case ServerSetting.TrustProxy:
      return DefaultTrustProxy.join(',');
    case ServerSetting.OidcScope:
      return 'openid profile email';
    case ServerSetting.OidcName:
      return 'single sign-on';
    case ServerSetting.OidcUsernameClaim:
      return 'preferred_username';
    case ServerSetting.OidcAutoRegister:
    case ServerSetting.OidcAutoLaunch:
      return 'false';
    case ServerSetting.PasswordLogin:
      return 'true';
    case ServerSetting.JwtExpiry:
      return '7d';
    case ServerSetting.BCryptStrength:
      return '10';
    case ServerSetting.Verbose:
      return 'false';
    default:
      return null;
  }
}

// What was stored when this instance started
let running: StoredServerSettings = new Map();
// What is stored now, for the settings that take effect when saved
let saved: StoredServerSettings = new Map();

export function UseStoredServerSettings(settings: StoredServerSettings) {
  running = settings;
  saved = settings;
}

// After settings were saved, so those that take effect right away do
export function UseSavedServerSettings(settings: StoredServerSettings) {
  saved = settings;
}

export function RunningStoredServerSettings(): StoredServerSettings {
  return running;
}

// The given settings, with those that take effect when saved as in current
export function WithLiveServerSettings(
  settings: StoredServerSettings,
  current: StoredServerSettings,
): StoredServerSettings {
  const merged = new Map(settings);
  for (const key of LiveServerSettings) {
    const value = current.get(key);
    if (value === undefined) merged.delete(key);
    else merged.set(key, value);
  }
  return merged;
}

export function EnvServerSetting(key: ServerSetting): string | undefined {
  const value = process.env[ServerSettingEnvName(key)]?.trim();
  if (!value) return undefined;
  // Like the other environment variables, these can be yes, no, 1 or 0 too
  if (BoolServerSettings.includes(key)) {
    const bool = ParseBool(value, null);
    if (bool !== null) return String(bool);
  }
  return value;
}

// How settings resolve with the given stored values: what is saved comes
// first, the environment only sets what is not saved
export function ServerSettingResolver(
  stored: StoredServerSettings,
): (key: ServerSetting) => string | undefined {
  return (key) => stored.get(key) ?? EnvServerSetting(key);
}

// A setting as this instance uses it
export function GetServerSetting(key: ServerSetting): string | undefined {
  const stored = LiveServerSettings.includes(key) ? saved : running;
  return ServerSettingResolver(stored)(key);
}

// Settings whose value from the environment was not valid, warned about once
const warnedInvalid = new Set<ServerSetting>();

// A setting as this instance uses it, or its default. Saved values are always
// valid, but values from the environment might not be, those are ignored.
export function GetServerSettingOrDefault(key: ServerSetting): string | null {
  const value = GetServerSetting(key);
  if (value === undefined) return ServerSettingDefault(key);

  const valid = ServerSettingValidators[key].safeParse(value);
  if (valid.success) return value;
  if (!warnedInvalid.has(key)) {
    warnedInvalid.add(key);
    new Logger('ServerSettings').warn(
      `${ServerSettingEnvName(key)} is ignored: ${valid.error.issues[0]?.message ?? 'Not a valid value'}`,
    );
  }
  return ServerSettingDefault(key);
}

export function GetServerSettingNumber(key: ServerSetting): number {
  return Number(GetServerSettingOrDefault(key));
}

export function GetServerSettingBool(key: ServerSetting): boolean {
  return GetServerSettingOrDefault(key) === 'true';
}

// In milliseconds
export function GetServerSettingDuration(key: ServerSetting): number {
  return ParseDuration(GetServerSettingOrDefault(key) ?? '') ?? 0;
}

// Reads stored settings, decrypting secrets. Only valid values can be saved,
// but the database can be edited by hand, and secrets can only be read with
// the key they were saved with.
export async function ParseStoredServerSettings(
  rows: { key: string; value: string }[],
  onIgnored?: (key: ServerSetting, reason: string) => void,
): Promise<StoredServerSettings> {
  const settings = new Map<ServerSetting, string>();
  for (const row of rows) {
    const key = row.key as ServerSetting;
    if (!ServerSettingList.includes(key)) continue;

    let value = row.value;
    if (SecretServerSettings.includes(key)) {
      const decrypted = await DecryptSetting(key, value);
      if (HasFailed(decrypted)) {
        onIgnored?.(key, decrypted.getReason());
        continue;
      }
      value = decrypted.value;
    }

    if (!ServerSettingValidators[key].safeParse(value).success) {
      onIgnored?.(key, 'it is not a valid value');
      continue;
    }
    settings.set(key, value);
  }
  return settings;
}

// How a setting is stored, secrets are encrypted
export async function StoredServerSettingValue(
  key: ServerSetting,
  value: string,
): Promise<string> {
  return SecretServerSettings.includes(key)
    ? EncryptSetting(key, value)
    : value;
}

async function readState(
  client: pg.Client,
  key: string,
): Promise<string | null> {
  try {
    const { rows } = await client.query<{ value: string }>(
      `SELECT "value" FROM "${SystemStateTable}" WHERE "key" = $1`,
      [key],
    );
    return rows[0]?.value ?? null;
  } catch (e: any) {
    // Created on the first start
    if (e?.code === '42P01') return null;
    throw e;
  }
}

// Saved settings used to come after the environment, and settings from the
// environment were saved as well. Those copies are dropped once, so the
// environment keeps setting what it set, until a setting is saved on the page.
export const ServerSettingsOrderState = 'server_settings_order';
export const SavedFirst = 'saved-first';

async function dropEnvironmentCopies(
  client: pg.Client,
  rows: { key: string; value: string }[],
  logger: Logger,
): Promise<{ key: string; value: string }[]> {
  if ((await readState(client, ServerSettingsOrderState)) === SavedFirst) {
    return rows;
  }

  const copies = rows.filter(
    (row) =>
      ServerSettingList.includes(row.key as ServerSetting) &&
      EnvServerSetting(row.key as ServerSetting) !== undefined,
  );
  await client.query('BEGIN');
  try {
    for (const row of copies) {
      await client.query(
        `DELETE FROM "${ServerSettingsTable}" WHERE "key" = $1`,
        [row.key],
      );
    }
    await client.query(
      `INSERT INTO "${SystemStateTable}" ("key", "value") VALUES ($1, $2)
       ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value"`,
      [ServerSettingsOrderState, SavedFirst],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  }

  if (copies.length > 0) {
    logger.log(
      `Settings saved on the settings page now come before environment variables. ${copies
        .map((row) => ServerSettingEnvName(row.key as ServerSetting))
        .join(
          ', ',
        )} were saved as well when the environment came first, those copies are removed so the environment still sets them.`,
    );
  }
  return rows.filter((row) => !copies.includes(row));
}

function createClient() {
  const options = GetDbConnectionOptions((name) => process.env[name]);
  return new pg.Client({
    host: options.host,
    port: options.port,
    user: options.username,
    password: options.password,
    database: options.database,
  });
}

// Reads the stored settings before Picsur itself starts. The database often
// starts at the same time, so this waits for it like TypeORM would.
export async function LoadStoredServerSettings(
  attempts = 10,
  delayMs = 3000,
): Promise<StoredServerSettings> {
  const logger = new Logger('ServerSettings');

  for (let attempt = 1; ; attempt++) {
    const client = createClient();
    try {
      await client.connect();
      UseGeneratedEncryptionKey(await readState(client, GeneratedKeyState));
      const { rows } = await client.query<{ key: string; value: string }>(
        `SELECT "key", "value" FROM "${ServerSettingsTable}"`,
      );
      const saved = await dropEnvironmentCopies(client, rows, logger);
      return await ParseStoredServerSettings(saved, (key, reason) => {
        if (SecretServerSettings.includes(key)) {
          logger.error(
            `The saved ${ServerSettingEnvName(key)} cannot be used, ${reason}. Set ${ServerSettingEnvName(key)} instead, or save it again on the settings page.`,
          );
        } else {
          logger.warn(`Ignoring the saved value of ${key}, ${reason}`);
        }
      });
    } catch (e: any) {
      // The table is created on the first start of a version that has it
      if (e?.code === '42P01') return new Map();
      if (attempt >= attempts) throw e;
      logger.warn(
        `Cannot read the settings from the database yet, trying again: ${e?.message ?? e}`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}

// Removes what is saved for the given settings, so the environment or the
// default applies to them again. Returns the ones that had something saved.
export async function RemoveStoredServerSettings(
  keys: ServerSetting[],
): Promise<ServerSetting[]> {
  const client = createClient();
  await client.connect();
  try {
    const { rows } = await client.query<{ key: ServerSetting }>(
      `DELETE FROM "${ServerSettingsTable}" WHERE "key" = ANY($1) RETURNING "key"`,
      [keys],
    );
    return rows.map((row) => row.key);
  } finally {
    await client.end().catch(() => undefined);
  }
}

// Replaces all stored settings, used to go back to settings that worked
export async function SaveStoredServerSettings(
  settings: StoredServerSettings,
): Promise<void> {
  const client = createClient();
  await client.connect();
  try {
    const rows: [ServerSetting, string][] = [];
    for (const [key, value] of settings) {
      rows.push([key, await StoredServerSettingValue(key, value)]);
    }

    await client.query('BEGIN');
    await client.query(`DELETE FROM "${ServerSettingsTable}"`);
    for (const row of rows) {
      await client.query(
        `INSERT INTO "${ServerSettingsTable}" ("key", "value") VALUES ($1, $2)`,
        row,
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await client.end().catch(() => undefined);
  }
}
