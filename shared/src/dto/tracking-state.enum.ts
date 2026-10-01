import { z } from 'zod';

export enum TrackingState {
  Disabled = 'disabled',
  Detailed = 'detailed',
}

export const TrackingStateSchema = z.nativeEnum(TrackingState);
