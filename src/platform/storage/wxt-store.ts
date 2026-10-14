import { storage } from 'wxt/utils/storage';
import type { StorageLike } from './types';

/**
 * The real storage adapter. Only `platform/storage` may import it (enforced by
 * ESLint), so every write goes through a repo and the shared queue.
 */
export function createWxtStore(): StorageLike {
  return {
    async get(key) {
      // WXT reports a missing key as `null`; the rest of the code expects `undefined`.
      return (await storage.getItem<unknown>(key)) ?? undefined;
    },
    set: (key, value) => storage.setItem(key, value),
    remove: (key) => storage.removeItem(key),
  };
}
