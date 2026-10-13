import type { StorageKey } from '@/contract/storage';

/**
 * The narrow storage surface the rest of the code depends on. The extension
 * uses the WXT adapter; tests use an in-memory one.
 */
export interface StorageLike {
  /** Resolves to `undefined` when the key is absent. */
  get(key: StorageKey): Promise<unknown>;
  set(key: StorageKey, value: unknown): Promise<void>;
  remove(key: StorageKey): Promise<void>;
}
