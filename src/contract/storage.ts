import { z } from 'zod';

/** Every persisted key names its storage area, the way WXT storage expects. */
export type StorageKey = `local:${string}` | `session:${string}`;

/**
 * What every key stores: the payload plus the schema version it was written
 * with. The version travels with the payload, so one key's upgrade never waits
 * on another key's (docs/development-plan.md §7).
 */
export const StorageEnvelope = z.object({
  version: z.number().int().positive(),
  data: z.unknown(),
});
export type StorageEnvelope = z.infer<typeof StorageEnvelope>;
