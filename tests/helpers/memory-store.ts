import type { StorageKey } from '@/contract/storage';
import type { StorageLike } from '@/platform/storage/types';

export interface MemoryStore extends StorageLike {
  /** A copy of everything stored, for assertions. */
  dump(): Record<string, unknown>;
}

/**
 * In-memory stand-in for extension storage. Like the real thing it is async
 * and stores copies, and every call yields to the event loop first, so
 * interleaved read-modify-write sequences really do interleave in tests.
 */
export function createMemoryStore(initial: Partial<Record<StorageKey, unknown>> = {}): MemoryStore {
  const data = new Map<string, unknown>(
    Object.entries(initial).map(([key, value]) => [key, structuredClone(value)]),
  );
  const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  return {
    async get(key) {
      await yieldToEventLoop();
      return structuredClone(data.get(key));
    },
    async set(key, value) {
      await yieldToEventLoop();
      data.set(key, structuredClone(value));
    },
    async remove(key) {
      await yieldToEventLoop();
      data.delete(key);
    },
    dump() {
      return Object.fromEntries([...data].map(([key, value]) => [key, structuredClone(value)]));
    },
  };
}
