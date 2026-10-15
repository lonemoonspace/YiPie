import { browser } from 'wxt/browser';
import type { StorageKey } from '@/contract/storage';

/**
 * Calls `listener` whenever one of `keys` changes, whoever wrote it (the
 * background, for any page). It is only a signal: the new value is read
 * through the background, which alone interprets what is stored. Returns the
 * unsubscribe. Extension pages and the service worker only: content scripts
 * cannot see `storage.local`.
 */
export function onStoredChange(keys: readonly StorageKey[], listener: () => void): () => void {
  const watched = new Set<string>(keys);
  const handle = (changes: Record<string, unknown>, area: string) => {
    if (Object.keys(changes).some((name) => watched.has(`${area}:${name}`))) listener();
  };
  browser.storage.onChanged.addListener(handle);
  return () => browser.storage.onChanged.removeListener(handle);
}
