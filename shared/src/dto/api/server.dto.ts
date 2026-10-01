import { z } from 'zod';
import { createZodDto } from '../../util/create-zod-dto.js';
import { IsPosInt } from '../../validators/positive-int.validator.js';

// ServerSettings

// A setting is what is saved on the settings page, and otherwise what its
// environment variable sets, and otherwise its default
export const ServerSettingStateSchema = z.object({
  key: z.string(),
  // What is saved, null when nothing is, and always for secrets
  value: z.string().nullable(),
  // Whether something is saved, also for secrets
  saved: z.boolean(),
  // The environment variable for it
  env: z.string(),
  // Its value, null when it is not set, and always for secrets
  env_value: z.string().nullable(),
  // Whether it is set, also for secrets
  env_set: z.boolean(),
  // What is used when neither is set, null when it is left out then
  default: z.string().nullable(),
  // Where the value in use comes from
  source: z.enum(['settings', 'environment', 'default']),
  // Whether it is saved or set in the environment, also for secrets
  set: z.boolean(),
});
export type ServerSettingState = z.infer<typeof ServerSettingStateSchema>;

// What can only be set with environment variables, as Picsur needs it before
// it can read its settings
export const EnvironmentOptionSchema = z.object({
  env: z.string(),
  // What applies, null for secrets
  value: z.string().nullable(),
  // Whether it is set, otherwise the default applies
  set: z.boolean(),
});
export type EnvironmentOption = z.infer<typeof EnvironmentOptionSchema>;

export const ServerSettingsResponseSchema = z.object({
  settings: z.array(ServerSettingStateSchema),
  environment: z.array(EnvironmentOptionSchema),
  // Settings changed since Picsur started that take effect when it restarts
  restart_needed: z.boolean(),
  // Why the last restart went back to the settings before it, if it did
  restart_error: z.string().nullable(),
  started_at: z.preprocess((data: any) => new Date(data), z.date()),
  // Where the key that encrypts saved secrets is kept: in the environment
  // (PICSUR_ENCRYPTION_KEY), or generated and kept in the database. Null when
  // there is none, and secrets cannot be saved.
  encryption_key: z.enum(['environment', 'database']).nullable(),
});
export class ServerSettingsResponse extends createZodDto(
  ServerSettingsResponseSchema,
) {}

export const ServerSettingsUpdateRequestSchema = z.object({
  // A value to save, or null to remove what is saved, so the environment or
  // the default applies again. Secrets left out stay as they are.
  values: z.record(z.string(), z.string().nullable()),
});
export class ServerSettingsUpdateRequest extends createZodDto(
  ServerSettingsUpdateRequestSchema,
) {}

// StorageTest, of the storage the given changes would result in

export const StorageTestRequestSchema =
  ServerSettingsUpdateRequestSchema.extend({
    // The bucket, or the directory
    storage: z.enum(['s3', 'filesystem']),
  });
export class StorageTestRequest extends createZodDto(
  StorageTestRequestSchema,
) {}

export const StorageTestResponseSchema = z.object({
  driver: z.enum(['s3', 'filesystem']),
  // The bucket, or the directory
  location: z.string(),
  // Whether it did not exist yet
  created: z.boolean(),
  // Something to look into, even though images can be stored there
  warning: z.string().nullable(),
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

const StorageDriverSchema = z.enum(['database', 's3', 'filesystem']);

const LocationCountsSchema = z.object({
  database: IsPosInt(),
  s3: IsPosInt(),
  filesystem: IsPosInt(),
});

// Moving image files to where new ones are stored
export const StorageMigrationStateSchema = z.object({
  running: z.boolean(),
  // Whether it was stopped before it was done
  stopped: z.boolean(),
  target: StorageDriverSchema.nullable(),
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
  driver: StorageDriverSchema,
  // Used whenever they are set, also to read images stored there before
  bucket: z.string().nullable(),
  path: z.string().nullable(),
  // Why images in the directory might not be safe there
  warning: z.string().nullable(),
  files: LocationCountsSchema,
  derivatives: LocationCountsSchema,
  migration: StorageMigrationStateSchema,
});
export class StorageStatusResponse extends createZodDto(
  StorageStatusResponseSchema,
) {}

// OidcTest, of the provider the given changes would result in

export const OidcTestRequestSchema = ServerSettingsUpdateRequestSchema;
export class OidcTestRequest extends createZodDto(OidcTestRequestSchema) {}

export const OidcTestResponseSchema = z.object({
  // What the provider calls itself
  issuer: z.string(),
});
export class OidcTestResponse extends createZodDto(OidcTestResponseSchema) {}
