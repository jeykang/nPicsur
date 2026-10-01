import { z } from 'zod';
import tuple from '../types/tuple.js';
import { IsEntityID } from '../validators/entity-id.validator.js';
import { IsPrefValue } from '../validators/pref-value.validator.js';

// Variable value type
export type PrefValueType = string | number | boolean;
export type PrefValueTypeStrings = 'string' | 'number' | 'boolean';
export const PrefValueTypes = tuple('string', 'number', 'boolean');

// Decoded Representations

export const DecodedPrefSchema = z.object({
  key: z.string(),
  value: IsPrefValue(),
  type: z.enum(PrefValueTypes),
});
export type DecodedPref = z.infer<typeof DecodedPrefSchema>;

export const DecodedUsrPrefSchema = DecodedPrefSchema.merge(
  z.object({
    user: IsEntityID(),
  }),
);
export type DecodedUsrPref = z.infer<typeof DecodedUsrPrefSchema>;
