import { ParseInt, ParseString } from 'picsur-shared/dist/util/parse-simple';
import { DefaultName, EnvPrefix } from './config.static.js';

// How to reach the database, from the PICSUR_DB_* environment variables
export function GetDbConnectionOptions(
  get: (name: string) => string | undefined,
) {
  return {
    host: ParseString(get(`${EnvPrefix}DB_HOST`), 'localhost'),
    port: ParseInt(get(`${EnvPrefix}DB_PORT`), 5432),
    username: ParseString(get(`${EnvPrefix}DB_USERNAME`), DefaultName),
    password: ParseString(get(`${EnvPrefix}DB_PASSWORD`), DefaultName),
    database: ParseString(get(`${EnvPrefix}DB_DATABASE`), DefaultName),
  };
}
