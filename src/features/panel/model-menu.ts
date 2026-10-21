import type { ModelChoice } from '@/contract/rpc';
import type { ModelPick } from './model-switcher';

/**
 * The menu groups model names under their configurations once any
 * configuration offers more than one; until then each configuration is one
 * entry, by its name, as before.
 */
export function isGrouped(choices: readonly ModelChoice[]): boolean {
  return choices.some((choice) => choice.models.length > 1);
}

/** An option's value: the configuration's id, or with one of its model names when grouped. */
export function optionValue(id: string, model?: string): string {
  return model === undefined ? id : JSON.stringify([id, model]);
}

/** The pick an option's value stands for; null for a value this menu did not write. */
export function pickOf(value: string, grouped: boolean): ModelPick | null {
  if (!grouped) return value === '' ? null : { id: value };
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || typeof parsed[0] !== 'string' || typeof parsed[1] !== 'string') {
    return null;
  }
  return { id: parsed[0], model: parsed[1] };
}
