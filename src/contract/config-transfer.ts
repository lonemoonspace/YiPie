import { z } from 'zod';
import { ModelConfigDraft } from './model-config';
import { PromptConfigDraft } from './prompt-config';

/**
 * The file the settings page exports and imports: model configurations and
 * prompts, as JSON (docs/development-plan.md §4.6). Ids are not in it: every
 * imported item gets a new one and is appended, so an import never replaces
 * what is already here.
 */
export const CONFIG_FILE_FORMAT = 'yipie-config';
export const CONFIG_FILE_VERSION = 1;

/** Items of each list one import may add. */
export const MAX_IMPORTED_ITEMS = 200;

/**
 * What the settings page sends once the user confirmed an import: only the
 * items it could read, each a draft the background checks again. An import
 * with nothing in it is refused, never applied as an empty change.
 */
export const ConfigImport = z
  .strictObject({
    models: z.array(ModelConfigDraft).max(MAX_IMPORTED_ITEMS),
    prompts: z.array(PromptConfigDraft).max(MAX_IMPORTED_ITEMS),
  })
  .refine(
    (input) => input.models.length + input.prompts.length > 0,
    'An import must add at least one item.',
  );
export type ConfigImport = z.input<typeof ConfigImport>;
