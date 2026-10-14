import { z } from 'zod';
import type { StorageKey } from './storage';

export const SELECTION_KEY: StorageKey = 'local:selection';
export const SELECTION_VERSION = 1;

/**
 * Which model and which prompt are the defaults (docs/development-plan.md
 * §4.3). An id that names no item, or none at all, means "the first one"
 * (domain/list-mutations `effectiveDefault`), so a stale id is harmless.
 */
export const Selection = z.looseObject({
  defaultModelId: z.string().nullable().default(null),
  defaultPromptId: z.string().nullable().default(null),
});
export type Selection = z.infer<typeof Selection>;

/** The field of `Selection` that holds one list's default. */
export type SelectionField = 'defaultModelId' | 'defaultPromptId';

export function defaultSelection(): Selection {
  return Selection.parse({});
}
