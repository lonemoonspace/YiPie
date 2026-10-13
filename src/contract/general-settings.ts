import { z } from 'zod';
import type { StorageKey } from './storage';

export const THEMES = ['system', 'light', 'dark'] as const;
export const Theme = z.enum(THEMES);
export type Theme = z.infer<typeof Theme>;

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const;
export const LogLevel = z.enum(LOG_LEVELS);
export type LogLevel = z.infer<typeof LogLevel>;

export const GENERAL_SETTINGS_KEY: StorageKey = 'local:general-settings';
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
});
export type GeneralSettingsPatch = z.infer<typeof GeneralSettingsPatch>;
