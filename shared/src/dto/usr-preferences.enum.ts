import { z } from 'zod';
import { IsExpiry } from '../validators/expiry.validator.js';
import { PrefValueTypeStrings } from './preferences.dto.js';

// This enum is only here to make accessing the values easier, and type checking in the backend
export enum UsrPreference {
  KeepOriginal = 'keep_original',
  // Seconds until new uploads expire, 0 for never
  DefaultExpiry = 'default_expiry',
}

export const UsrPreferenceList: string[] = Object.values(UsrPreference);

// Syspref Value types
export const UsrPreferenceValueTypes: {
  [key in UsrPreference]: PrefValueTypeStrings;
} = {
  [UsrPreference.KeepOriginal]: 'boolean',
  [UsrPreference.DefaultExpiry]: 'number',
};

export const UsrPreferenceValidators: {
  [key in UsrPreference]: z.ZodTypeAny;
} = {
  [UsrPreference.KeepOriginal]: z.boolean(),
  [UsrPreference.DefaultExpiry]: IsExpiry(),
};
