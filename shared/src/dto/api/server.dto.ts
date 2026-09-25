import { z } from 'zod';
import { createZodDto } from '../../util/create-zod-dto.js';
import { IsPosInt } from '../../validators/positive-int.validator.js';

// ServerSettings

export const ServerSettingStateSchema = z.object({
  key: z.string(),
  // Null when it is not set, and always for secrets
  value: z.string().nullable(),
  // Whether it has a value, also for secrets
  set: z.boolean(),
  // What is used when it is not set
  default: z.string().nullable(),
  // Settings from the environment can not be changed here
  source: z.enum(['environment', 'settings', 'default']),
  // Whether the value is saved in the settings. Values from the environment
  // are saved as well, so the variable can be removed later.
  saved: z.boolean(),
  env: z.string(),
});
export type ServerSettingState = z.infer<typeof ServerSettingStateSchema>;

export const ServerSettingsResponseSchema = z.object({
  settings: z.array(ServerSettingStateSchema),
  // Settings changed since Picsur started, they take effect when it restarts
  restart_needed: z.boolean(),
  // Why the last restart went back to the settings before it, if it did
  restart_error: z.string().nullable(),
  started_at: z.preprocess((data: any) => new Date(data), z.date()),
  // Secrets are only saved encrypted, which needs PICSUR_ENCRYPTION_KEY
  can_save_secrets: z.boolean(),
});
export class ServerSettingsResponse extends createZodDto(
  ServerSettingsResponseSchema,
) {}

export const ServerSettingsUpdateRequestSchema = z.object({
  // A value to use, or null to go back to the default. Secrets left out stay
  // as they are.
  values: z.record(z.string(), z.string().nullable()),
});
export class ServerSettingsUpdateRequest extends createZodDto(
  ServerSettingsUpdateRequestSchema,
) {}

// StorageTest, of the storage the given changes would result in

export const StorageTestResponseSchema = z.object({
  bucket: z.string(),
  created: z.boolean(),
});
export class StorageTestResponse extends createZodDto(
  StorageTestResponseSchema,
) {}

// ServerRestart

export const ServerRestartResponseSchema = z.object({
  started_at: z.preprocess((data: any) => new Date(data), z.date()),
});
export class ServerRestartResponse extends createZodDto(
  ServerRestartResponseSchema,
) {}

// StorageStatus

const LocationCountsSchema = z.object({
  database: IsPosInt(),
  object_storage: IsPosInt(),
});

// Moving image files to where new ones are stored
export const StorageMigrationStateSchema = z.object({
  running: z.boolean(),
  // Whether it was stopped before it was done
  stopped: z.boolean(),
  target: z.enum(['database', 's3']).nullable(),
  // How many files there were to move when it started
  total: IsPosInt(),
  moved: IsPosInt(),
  failed: IsPosInt(),
  started_at: z.preprocess((data: any) => new Date(data), z.date()).nullable(),
  finished_at: z.preprocess((data: any) => new Date(data), z.date()).nullable(),
  error: z.string().nullable(),
});
export type StorageMigrationState = z.infer<typeof StorageMigrationStateSchema>;

export const StorageStatusResponseSchema = z.object({
  // Where new image data goes
  driver: z.enum(['database', 's3']),
  bucket: z.string().nullable(),
  files: LocationCountsSchema,
  derivatives: LocationCountsSchema,
  migration: StorageMigrationStateSchema,
});
export class StorageStatusResponse extends createZodDto(
  StorageStatusResponseSchema,
) {}
