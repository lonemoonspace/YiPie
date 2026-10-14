import { z } from 'zod';
import { GENERAL_SETTINGS_KEY } from './general-settings';
import { MODEL_CONFIGS_KEY } from './model-config';
import { PROMPT_CONFIGS_KEY } from './prompt-config';
import { SELECTION_KEY } from './selection';

/**
 * The records whose backups the settings page shows: what the user keeps in
 * `storage.local` (docs/development-plan.md §7). The panel registry lives in
 * `storage.session` and is the extension's own bookkeeping.
 */
export const BACKED_UP_KEYS = [
  MODEL_CONFIGS_KEY,
  PROMPT_CONFIGS_KEY,
  SELECTION_KEY,
  GENERAL_SETTINGS_KEY,
] as const;
export const BackedUpKey = z.enum(BACKED_UP_KEYS);
export type BackedUpKey = z.infer<typeof BackedUpKey>;

/** A value that could not be read, copied aside before a save replaced it. */
export const Backup = z.object({
  key: BackedUpKey,
  /** ISO time of the backup, or `unknown` for a damaged entry of the backup list itself. */
  at: z.string(),
  /** Exactly what was stored; credentials included. */
  raw: z.unknown(),
});
export type Backup = z.infer<typeof Backup>;

export const BackupsView = z.object({ backups: z.array(Backup) });
export type BackupsView = z.infer<typeof BackupsView>;
