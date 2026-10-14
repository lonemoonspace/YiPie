import { z } from 'zod';
import { GENERAL_SETTINGS_KEY } from './general-settings';
import { MODEL_CONFIGS_KEY } from './model-config';
import { PROMPT_CONFIGS_KEY } from './prompt-config';
import { SELECTION_KEY } from './selection';

/**
 * The keys whose unreadable values are backed up before being replaced, and
 * whose backups the settings page shows (docs/development-plan.md §7).
 */
export const BACKED_UP_KEYS = [
  GENERAL_SETTINGS_KEY,
  MODEL_CONFIGS_KEY,
  PROMPT_CONFIGS_KEY,
  SELECTION_KEY,
] as const;
export const BackedUpKey = z.enum(BACKED_UP_KEYS);
export type BackedUpKey = z.infer<typeof BackedUpKey>;

/** One backup: what was stored under `key` before it was replaced. */
export const Backup = z.object({
  key: BackedUpKey,
  /** Position among this key's backups, oldest first. */
  index: z.number().int().min(0),
  /** When it was backed up (ISO), or `unknown` for a damaged backup list. */
  at: z.string(),
  /** The value exactly as it was stored. May contain API keys. */
  raw: z.unknown(),
});
export type Backup = z.infer<typeof Backup>;

export const BackupsView = z.object({ backups: z.array(Backup) });
export type BackupsView = z.infer<typeof BackupsView>;

/** Names one backup; `at` must still match, so a changed list cannot lose the wrong one. */
export const BackupRef = z.strictObject({
  key: BackedUpKey,
  index: z.number().int().min(0),
  at: z.string(),
});
export type BackupRef = z.infer<typeof BackupRef>;
