import { z } from 'zod';
import { LOCALES } from './rpc-wire';
import type { StorageKey } from './storage';

export const THEMES = ['system', 'light', 'dark'] as const;
export const Theme = z.enum(THEMES);
export type Theme = z.infer<typeof Theme>;

/**
 * The interface language (docs/development-plan.md §4.7): `auto` follows the
 * browser's own language (Chinese for any `zh`, English otherwise).
 */
export const INTERFACE_LANGUAGES = ['auto', ...LOCALES] as const;
export const InterfaceLanguage = z.enum(INTERFACE_LANGUAGES);
export type InterfaceLanguage = z.infer<typeof InterfaceLanguage>;

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const;
export const LogLevel = z.enum(LOG_LEVELS);
export type LogLevel = z.infer<typeof LogLevel>;

/**
 * Which part of a page text too long for the model's context window is cut
 * (docs/development-plan.md §4.4, decision 4): the end, the middle or the
 * start. `nothing` sends the text as it is, the user's explicit choice; when
 * the service refuses it as too long, the panel offers to cut and retry.
 */
export const TRIMMING_STRATEGIES = ['back', 'middle', 'front', 'nothing'] as const;
export const TrimmingStrategy = z.enum(TRIMMING_STRATEGIES);
export type TrimmingStrategy = z.infer<typeof TrimmingStrategy>;

/** Size of the panel's reading text: four steps (docs/development-plan.md §4.6). */
export const FONT_SIZES = ['small', 'medium', 'large', 'x-large'] as const;
export const FontSize = z.enum(FONT_SIZES);
export type FontSize = z.infer<typeof FontSize>;

/**
 * The language answers are written in, for `{{language}}`: the interface's,
 * the page's own (from its `lang`, else the interface's), or a fixed one.
 */
export const ANSWER_LANGUAGES = [
  'interface',
  'page',
  'zh-Hans',
  'zh-Hant',
  'en',
  'ja',
  'ko',
  'fr',
  'de',
  'es',
] as const;
export const AnswerLanguage = z.enum(ANSWER_LANGUAGES);
export type AnswerLanguage = z.infer<typeof AnswerLanguage>;

export const GENERAL_SETTINGS_KEY = 'local:general-settings' satisfies StorageKey;
export const GENERAL_SETTINGS_VERSION = 1;

/**
 * Stored shape. Every field carries its own default, so a value written
 * before a field existed still reads; unknown fields pass through untouched,
 * so an older build never strips what a newer one added. Adding a field this
 * way is not a structural change and needs no version bump; renaming,
 * removing or redefining one does.
 */
export const GeneralSettings = z.looseObject({
  theme: Theme.default('system'),
  logLevel: LogLevel.default('info'),
  /** Keeps the start of the page, as phase 1 and 2 always did. */
  trimming: TrimmingStrategy.default('back'),
  fontSize: FontSize.default('medium'),
  answerLanguage: AnswerLanguage.default('interface'),
  interfaceLanguage: InterfaceLanguage.default('auto'),
});
export type GeneralSettings = z.infer<typeof GeneralSettings>;

export function defaultGeneralSettings(): GeneralSettings {
  return GeneralSettings.parse({});
}

/**
 * A patch names only the fields it changes and carries no defaults.
 * `GeneralSettings.partial()` would keep the defaults and silently reset every
 * field the patch left out — the phase-0 prototype shipped exactly that bug.
 */
export const GeneralSettingsPatch = z.strictObject({
  theme: Theme.optional(),
  logLevel: LogLevel.optional(),
  trimming: TrimmingStrategy.optional(),
  fontSize: FontSize.optional(),
  answerLanguage: AnswerLanguage.optional(),
  interfaceLanguage: InterfaceLanguage.optional(),
});
export type GeneralSettingsPatch = z.infer<typeof GeneralSettingsPatch>;
