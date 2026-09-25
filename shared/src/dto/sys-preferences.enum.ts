import { z } from 'zod';
import { IsEntityID } from '../validators/entity-id.validator.js';
import { IsValidMS } from '../validators/ms.validator.js';
import { IsHttpUrl } from '../validators/url.validator.js';
import { PrefValueTypeStrings } from './preferences.dto.js';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

// This enum is only here to make accessing the values easier, and type checking in the backend
export enum SysPreference {
  HostOverride = 'host_override',

  JwtSecret = 'jwt_secret',
  JwtExpiresIn = 'jwt_expires_in',
  BCryptStrength = 'bcrypt_strength',

  RemoveDerivativesAfter = 'remove_derivatives_after',
  AllowEditing = 'allow_editing',

  ConversionTimeLimit = 'conversion_time_limit',
  ConversionMemoryLimit = 'conversion_memory_limit',

  EnableTracking = 'enable_tracking',
  TrackingUrl = 'tracking_url',
  TrackingId = 'tracking_id',
}

export type SysPreferences = SysPreference[];
export const SysPreferenceList: string[] = Object.values(SysPreference);

// Syspref Value types
export const SysPreferenceValueTypes: {
  [key in SysPreference]: PrefValueTypeStrings;
} = {
  [SysPreference.HostOverride]: 'string',

  [SysPreference.JwtSecret]: 'string',
  [SysPreference.JwtExpiresIn]: 'string',
  [SysPreference.BCryptStrength]: 'number',

  [SysPreference.RemoveDerivativesAfter]: 'string',
  [SysPreference.AllowEditing]: 'boolean',

  [SysPreference.ConversionTimeLimit]: 'string',
  [SysPreference.ConversionMemoryLimit]: 'number',

  [SysPreference.EnableTracking]: 'boolean',
  [SysPreference.TrackingUrl]: 'string',
  [SysPreference.TrackingId]: 'string',
};

export const SysPreferenceValidators: {
  [key in SysPreference]: z.ZodTypeAny;
} = {
  [SysPreference.HostOverride]: IsHttpUrl().or(z.literal('')),

  // Short secrets are allowed, as they always were, but warned about when
  // Picsur starts
  [SysPreference.JwtSecret]: z.string().min(1),
  // Too short and nobody can stay logged in, including the admin
  [SysPreference.JwtExpiresIn]: IsValidMS(MINUTE, 365 * DAY),

  // Every increment doubles the time it takes to log in
  [SysPreference.BCryptStrength]: z.number().int().min(4).max(15),
  // 0 disables the cleanup
  [SysPreference.RemoveDerivativesAfter]: IsValidMS(MINUTE).or(IsValidMS(0, 0)),

  [SysPreference.AllowEditing]: z.boolean(),
  [SysPreference.ConversionTimeLimit]: IsValidMS(0, 10 * MINUTE),
  [SysPreference.ConversionMemoryLimit]: z.number().int().min(16).max(65536),

  [SysPreference.EnableTracking]: z.boolean(),
  [SysPreference.TrackingUrl]: IsHttpUrl().or(z.literal('')),
  [SysPreference.TrackingId]: IsEntityID().or(z.literal('')),
};
