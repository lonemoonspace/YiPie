import { z } from 'zod';
import type { StorageKey } from './storage';

export const PROMPT_CONFIGS_KEY: StorageKey = 'local:prompt-configs';
export const PROMPT_CONFIGS_VERSION = 1;

/**
 * A prompt: a system template and a user template, filled with the page's
 * variables by domain/prompt/render (docs/development-plan.md §4.3). Stored as
 * `{ version, data: PromptConfig[] }`. Like every stored shape, each field has
 * a default and unknown fields pass through.
 */
export const PromptConfig = z.looseObject({
  id: z.string().min(1),
  name: z.string().default(''),
  /** May be empty: then no system message is sent. */
  system: z.string().default(''),
  /** Carries the page, usually through `{{content}}`. */
  user: z.string().default(''),
});
export type PromptConfig = z.infer<typeof PromptConfig>;

const Name = z.string().trim().min(1).max(200);
const Template = z.string().max(100_000);
/** Whitespace in a template is the user's to keep, so it is checked, not trimmed. */
const UserTemplate = Template.refine((text) => text.trim() !== '', 'The user template is empty.');

/** What the settings page submits to create a prompt; the id is assigned on save. */
export const PromptConfigDraft = z.strictObject({
  name: Name,
  system: Template.default(''),
  user: UserTemplate,
});
export type PromptConfigDraft = z.input<typeof PromptConfigDraft>;

/** Changes to one prompt: only the fields it names, no defaults (see `GeneralSettingsPatch`). */
export const PromptConfigPatch = z.strictObject({
  name: Name.optional(),
  system: Template.optional(),
  user: UserTemplate.optional(),
});
export type PromptConfigPatch = z.infer<typeof PromptConfigPatch>;
