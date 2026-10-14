import { z } from 'zod';
import type { StorageKey } from './storage';

export const PROMPT_CONFIGS_KEY: StorageKey = 'local:prompt-configs';
export const PROMPT_CONFIGS_VERSION = 1;

/** Text with at least one character that is not white space. */
const NonBlank = z.string().regex(/\S/);

/**
 * One prompt: a system template and a user template, filled in with the
 * page's variables (`{{title}}`, `{{content}}`…, see domain/prompt/render).
 * Stored as a list, `{ version, data: PromptConfig[] }`; unknown fields pass
 * through, as with every stored shape (docs/development-plan.md §7).
 */
export const PromptConfig = z.looseObject({
  id: z.string().min(1),
  name: NonBlank,
  /** Sent as the system message; empty means no system message. */
  system: z.string().default(''),
  /** Sent as the user message. */
  user: NonBlank,
});
export type PromptConfig = z.infer<typeof PromptConfig>;

export const PromptConfigList = z.array(PromptConfig);
export type PromptConfigList = z.infer<typeof PromptConfigList>;

/** What the settings page submits to create a prompt; the id is assigned on save. */
export const PromptConfigDraft = z.strictObject({
  name: NonBlank,
  system: z.string().default(''),
  user: NonBlank,
});
export type PromptConfigDraft = z.input<typeof PromptConfigDraft>;

/** Changes to one prompt: only the fields named, no defaults (see `GeneralSettingsPatch`). */
export const PromptConfigPatch = z.strictObject({
  name: NonBlank.optional(),
  system: z.string().optional(),
  user: NonBlank.optional(),
});
export type PromptConfigPatch = z.infer<typeof PromptConfigPatch>;
