import type { StorageKey } from '@/contract/storage';
import type { StorageLike } from './types';

/** How many backups of one key are kept; older ones are dropped first. */
export const QUARANTINE_LIMIT = 3;

export interface QuarantineEntry {
  key: StorageKey;
  /** ISO timestamp of the backup, or `unknown` for a value found in an unexpected shape. */
  at: string;
  raw: unknown;
}

/** Backups live in the same area as the original, under one key per original key. */
export function quarantineKeyFor(key: StorageKey): StorageKey {
  const separator = key.indexOf(':');
  const area = key.slice(0, separator) as 'local' | 'session';
  return `${area}:quarantine:${key.slice(separator + 1)}`;
}

/**
 * Copies a value we could not read to its quarantine key before it is
 * overwritten. Nothing a user stored is ever silently replaced: the original
 * survives here until the user deletes it (docs/development-plan.md §7).
 *
 * Must run inside the write queue, like every other write.
 */
export async function quarantine(
  store: StorageLike,
  key: StorageKey,
  raw: unknown,
  now: Date = new Date(),
): Promise<void> {
  const backupKey = quarantineKeyFor(key);
  const entries = toEntries(key, await store.get(backupKey));
  const next = [...entries, { key, at: now.toISOString(), raw }].slice(-QUARANTINE_LIMIT);
  await store.set(backupKey, next);
}

export async function readQuarantine(
  store: StorageLike,
  key: StorageKey,
): Promise<QuarantineEntry[]> {
  return toEntries(key, await store.get(quarantineKeyFor(key)));
}

/**
 * Deletes the first backup of `key` taken at `at`; the user's explicit
 * action, the only way a backup goes (docs/development-plan.md §7). Resolves
 * to whether there was one. Must run inside the write queue.
 */
export async function removeQuarantined(
  store: StorageLike,
  key: StorageKey,
  at: string,
): Promise<boolean> {
  const backupKey = quarantineKeyFor(key);
  const entries = toEntries(key, await store.get(backupKey));
  const index = entries.findIndex((entry) => entry.at === at);
  if (index === -1) return false;
  const rest = entries.filter((_, i) => i !== index);
  if (rest.length === 0) await store.remove(backupKey);
  else await store.set(backupKey, rest);
  return true;
}

function toEntries(key: StorageKey, stored: unknown): QuarantineEntry[] {
  if (stored === undefined) return [];
  // Even a damaged backup list is kept rather than replaced: whatever is not
  // a backup becomes one, with an unknown time.
  if (!Array.isArray(stored)) return [{ key, at: 'unknown', raw: stored }];
  return stored.map((entry: unknown) =>
    isEntry(entry) ? { key, at: entry.at, raw: entry.raw } : { key, at: 'unknown', raw: entry },
  );
}

function isEntry(value: unknown): value is { at: string; raw: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { at?: unknown }).at === 'string' &&
    Object.hasOwn(value, 'raw')
  );
}
