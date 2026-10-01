import { z } from 'zod';
import { UUIDRegex } from '../util/common-regex.js';

// The id of anything stored, which are all UUIDs
export const IsEntityID = () => z.string().regex(UUIDRegex, 'Invalid id');
