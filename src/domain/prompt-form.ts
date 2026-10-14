import type { PromptConfig } from '@/contract/prompt-config';
import { t } from '@/domain/i18n';
import { SUMMARY_SYSTEM_TEMPLATE, SUMMARY_USER_TEMPLATE } from '@/domain/prompt/default-prompt';
import { unknownPlaceholders, usesVariable } from '@/domain/prompt/render';

/** The prompt form as the user typed it. */
export interface PromptFormFields {
  name: string;
  system: string;
  user: string;
}

export type PromptFormErrors = Partial<Record<keyof PromptFormFields, string>>;

/** Things worth knowing that do not stop a save, per template field. */
export type PromptFormWarnings = Partial<Record<'system' | 'user', string[]>>;

export type PromptFormResult =
  { ok: true; value: PromptFormFields } | { ok: false; errors: PromptFormErrors };

/** A new prompt starts from the built-in templates: writing one from nothing is hard. */
export function newPromptForm(): PromptFormFields {
  return { name: '', system: SUMMARY_SYSTEM_TEMPLATE, user: SUMMARY_USER_TEMPLATE };
}

export function formFromPrompt(config: PromptConfig): PromptFormFields {
  return { name: config.name, system: config.system, user: config.user };
}

/**
 * Checks the form before anything is sent; the background validates again
 * with the contract schemas. The templates are kept exactly as typed.
 */
export function parsePromptForm(fields: PromptFormFields): PromptFormResult {
  const errors: PromptFormErrors = {};
  const name = fields.name.trim();
  if (name === '') errors.name = t('prompt.error.name');
  if (fields.user.trim() === '') errors.user = t('prompt.error.user');
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { name, system: fields.system, user: fields.user } };
}

/**
 * Unknown placeholders are sent as written (docs/development-plan.md §4.3,
 * decision 3) and the editor points them out; so does a pair of templates
 * that never sends the page.
 */
export function promptFormWarnings(fields: PromptFormFields): PromptFormWarnings {
  const warnings: PromptFormWarnings = {};
  for (const field of ['system', 'user'] as const) {
    const unknown = unknownPlaceholders(fields[field]);
    if (unknown.length > 0) {
      warnings[field] = [t('prompt.warning.unknown', { placeholders: unknown.join('、') })];
    }
  }
  if (!usesVariable(fields.system, 'content') && !usesVariable(fields.user, 'content')) {
    warnings.user = [
      ...(warnings.user ?? []),
      t('prompt.warning.noContent', { placeholder: '{{content}}' }),
    ];
  }
  return warnings;
}
