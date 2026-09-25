import { Logger } from '@nestjs/common';
import { availableParallelism } from 'node:os';
import pg from 'pg';
import {
  SecretServerSettings,
  ServerSetting,
  ServerSettingEnvName,
  ServerSettingList,
  ServerSettingValidators,
} from 'picsur-shared/dist/dto/server-settings.dto';
import { HasFailed } from 'picsur-shared/dist/types/failable';
import { ServerSettingsTable } from '../database/entities/system/server-setting.entity.js';
import { GetDbConnectionOptions } from './db-connection.js';
import {
  DecryptSetting,
  EncryptionKeyEnv,
  EncryptSetting,
} from './settings-encryption.js';

// Server settings come from the environment first, and otherwise from what is
// stored in the database, which the settings page changes. Either way they
// are only read when Picsur starts, changes take effect on a restart.

export type StoredServerSettings = ReadonlyMap<ServerSetting, string>;

export const DefaultMaxFileSize = 128000000;
export const DefaultConversionRateLimit = 120;
export const DefaultS3Region = 'us-east-1';
// Any address in a private range, which covers a reverse proxy in the same
// docker network
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
    case ServerSetting.TrustProxy:
      return DefaultTrustProxy.join(',');
    default:
      return null;
  }
}

// What was stored when this instance started
let running: StoredServerSettings = new Map();

export function UseStoredServerSettings(settings: StoredServerSettings) {
  running = settings;
}

export function RunningStoredServerSettings(): StoredServerSettings {
  return running;
}

export function EnvServerSetting(key: ServerSetting): string | undefined {
  const value = process.env[ServerSettingEnvName(key)]?.trim();
  return value ? value : undefined;
}

// How settings resolve with the given stored values
export function ServerSettingResolver(
  stored: StoredServerSettings,
): (key: ServerSetting) => string | undefined {
  return (key) => EnvServerSetting(key) ?? stored.get(key);
}

// A setting as this instance uses it
export function GetServerSetting(key: ServerSetting): string | undefined {
  return ServerSettingResolver(running)(key);
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
      value = decrypted;
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
      const { rows } = await client.query<{ key: string; value: string }>(
        `SELECT "key", "value" FROM "${ServerSettingsTable}"`,
      );
      return await ParseStoredServerSettings(rows, (key, reason) => {
        if (SecretServerSettings.includes(key)) {
          logger.error(
            `The saved ${ServerSettingEnvName(key)} can not be used, ${reason}. Set ${EncryptionKeyEnv} to the key it was saved with, or set ${ServerSettingEnvName(key)} itself.`,
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
        `Can not read the settings from the database yet, trying again: ${e?.message ?? e}`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } finally {
      await client.end().catch(() => undefined);
    }
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
