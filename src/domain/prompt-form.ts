import type { PromptConfig } from '@/contract/prompt-config';
import { locale, t } from '@/domain/i18n';
import { builtinPrompts, summaryTemplates } from '@/domain/prompt/default-prompt';
import {
  PROMPT_VARIABLES,
  renderTemplate,
  unknownPlaceholders,
  usesVariable,
  type PromptValues,
} from '@/domain/prompt/render';

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

/**
 * A new prompt starts from the built-in templates, in the interface language:
 * writing one from nothing is hard.
 */
export function newPromptForm(): PromptFormFields {
  return { name: '', ...summaryTemplates(locale()) };
}

/**
 * The built-in prompts, in the interface language, as forms a new prompt can
 * start from: the way to get a preset back once the list is the user's own.
 */
export function presetForms(): PromptFormFields[] {
  return builtinPrompts(locale()).map(({ name, system, user }) => ({ name, system, user }));
}

/**
 * A line that tells `prompt` apart in a list: the first line of its system
 * template (or else its user template) that the other prompts do not all
 * share. The built-in prompts open with the same sentence, and their next
 * line says what each one writes.
 */
export function distinctiveLine(
  prompt: Pick<PromptConfig, 'system' | 'user'>,
  others: readonly Pick<PromptConfig, 'system' | 'user'>[],
): string {
  const text = prompt.system.trim() || prompt.user.trim();
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const shared = (line: string) =>
    others.length > 0 && others.every((other) => other.system.includes(line));
  return lines.find((line) => !shared(line)) ?? lines[0] ?? '';
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
 * Unknown placeholders, per template: sent as written (docs/development-plan.md
 * §4.3, decision 3), and marked in red by the editor (§4.6) without blocking
 * a save.
 */
export function unknownVariableFlags(fields: PromptFormFields): PromptFormWarnings {
  const flags: PromptFormWarnings = {};
  for (const field of ['system', 'user'] as const) {
    const unknown = unknownPlaceholders(fields[field]);
    if (unknown.length > 0) {
      flags[field] = [t('prompt.warning.unknown', { placeholders: unknown.join('、') })];
    }
  }
  return flags;
}

/** A pair of templates that never sends the page is worth a word too. */
export function promptFormWarnings(fields: PromptFormFields): PromptFormWarnings {
  return !usesVariable(fields.system, 'content') && !usesVariable(fields.user, 'content')
    ? { user: [t('prompt.warning.noContent', { placeholder: '{{content}}' })] }
    : {};
}

/** The variables a template may use, each with what it stands for, for the editor's hints. */
export function variableHints(): { placeholder: string; meaning: string }[] {
  return PROMPT_VARIABLES.map((name) => ({
    placeholder: `{{${name}}}`,
    meaning: t(`prompt.variable.${name}`),
  }));
}

/**
 * The templates as a model would get them for a made-up page, for the
 * editor's preview: every variable filled with a sample, unknown
 * placeholders left as written.
 */
export function previewPrompt(fields: PromptFormFields): { system: string; user: string } {
  const sample: PromptValues = {
    title: t('prompt.sample.title'),
    url: 'https://example.com/notes/yipie',
    content: t('prompt.sample.content'),
    selection: t('prompt.sample.selection'),
    language: t('prompt.answerLanguage'),
  };
  return {
    system: renderTemplate(fields.system, sample),
    user: renderTemplate(fields.user, sample),
  };
}
