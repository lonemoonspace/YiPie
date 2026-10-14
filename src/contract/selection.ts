import { z } from 'zod';
import type { StorageKey } from './storage';

export const SELECTION_KEY: StorageKey = 'local:selection';
export const SELECTION_VERSION = 1;

/**
 * Which model and which prompt are the defaults, by id. An id that no longer
 * names an item falls back to the first one (domain/list-mutations), so a
 * stale id is harmless.
 */
export const Selection = z.looseObject({
  defaultModelId: z.string().nullable().default(null),
  defaultPromptId: z.string().nullable().default(null),
});
export type Selection = z.infer<typeof Selection>;

export function defaultSelection(): Selection {
  return Selection.parse({});
}
