import type { PromptConfig } from '@/contract/prompt-config';
import { t } from '@/domain/i18n';
import { templateVariables } from '@/domain/prompt/render';

/** The prompt form as typed. */
export interface PromptFormFields {
  name: string;
  system: string;
  user: string;
}

export type PromptFormErrors = Partial<Record<keyof PromptFormFields, string>>;

export type PromptFormResult =
  { ok: true; value: PromptFormFields } | { ok: false; errors: PromptFormErrors };

export const EMPTY_PROMPT_FORM: PromptFormFields = { name: '', system: '', user: '' };

export function formFromPrompt(
  prompt: Pick<PromptConfig, 'name' | 'system' | 'user'>,
): PromptFormFields {
  return { name: prompt.name, system: prompt.system, user: prompt.user };
}

/**
 * Checks the form before anything is sent, so each error shows next to its
 * field; the background validates again with the contract. Templates are kept
 * exactly as typed: spacing in them may matter to the user.
 */
export function parsePromptForm(fields: PromptFormFields): PromptFormResult {
  const errors: PromptFormErrors = {};
  const name = fields.name.trim();
  if (name === '') errors.name = t('prompt.error.name');
  if (fields.user.trim() === '') errors.user = t('prompt.error.user');
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { name, system: fields.system, user: fields.user } };
}

export interface PromptWarnings {
  /** Placeholders that are not variables: they reach the model as written. */
  unknown: string[];
  /** Neither template uses the page text, so the model would not see it. */
  noContent: boolean;
}

/** What the editor points out while the user types; none of it blocks saving. */
export function promptWarnings(fields: Pick<PromptFormFields, 'system' | 'user'>): PromptWarnings {
  const system = templateVariables(fields.system);
  const user = templateVariables(fields.user);
  const used = new Set([...system.used, ...user.used]);
  return {
    unknown: [...new Set([...system.unknown, ...user.unknown])],
    noContent: !used.has('content') && !used.has('selection'),
  };
}
