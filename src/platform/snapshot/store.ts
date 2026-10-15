import {
  SNAPSHOT_EVICTED_LIMIT,
  SNAPSHOT_INDEX_KEY,
  SNAPSHOT_INDEX_VERSION,
  SNAPSHOT_PAGE_BYTES,
  SNAPSHOT_TOTAL_BYTES,
  SNAPSHOT_VERSION,
  Snapshot,
  SnapshotIndex,
  snapshotKey,
  type SnapshotIndexEntry,
  type SnapshotMessage,
} from '@/contract/snapshot';
import { createRepo, type Queue, type StorageLike } from '@/platform/storage';

export type SnapshotLookup =
  | { status: 'found'; messages: SnapshotMessage[]; truncated: boolean }
  /** Nothing was saved for this page in this tab. */
  | { status: 'none' }
  /** A conversation was saved, then evicted to make room for others. */
  | { status: 'evicted' };

export interface SnapshotSaved {
  /** The oldest messages did not fit the page's limit and were left out. */
  truncated: boolean;
}

export interface SnapshotStore {
  /** The conversation saved for `pageKey` in `tabId`. Restoring it counts as using it. */
  get(tabId: number, pageKey: string): Promise<SnapshotLookup>;
  /** Saves the whole conversation, replacing what was saved for the page before. */
  save(tabId: number, pageKey: string, messages: SnapshotMessage[]): Promise<SnapshotSaved>;
  /** Deletes every conversation of a tab that was closed. */
  removeTab(tabId: number): Promise<void>;
}

export interface SnapshotLimits {
  totalBytes: number;
  pageBytes: number;
  evictedLimit: number;
}

export interface SnapshotStoreDeps {
  newId?: () => string;
  now?: () => number;
  limits?: SnapshotLimits;
}

/** Even the latest answer alone is over the page's limit. */
export class SnapshotTooLargeError extends Error {
  constructor() {
    super('The conversation is too long to save, even its latest answer alone.');
    this.name = 'SnapshotTooLargeError';
  }
}

const DEFAULT_LIMITS: SnapshotLimits = {
  totalBytes: SNAPSHOT_TOTAL_BYTES,
  pageBytes: SNAPSHOT_PAGE_BYTES,
  evictedLimit: SNAPSHOT_EVICTED_LIMIT,
};

/**
 * Conversation snapshots in `storage.session` (docs/development-plan.md §4.4,
 * decisions 1–3). Runs in the service worker; every change goes through the
 * shared write queue.
 *
 * The index never misses a stored conversation: a conversation's key is
 * removed before its entry, and written after it. An entry whose key is gone
 * (the worker stopped between two writes, a write failed) reads as nothing
 * saved; a key no entry knows about would hold memory until the browser
 * restarts.
 */
export function createSnapshotStore(
  store: StorageLike,
  queue: Queue,
  {
    newId = () => crypto.randomUUID(),
    now = () => Date.now(),
    limits = DEFAULT_LIMITS,
  }: SnapshotStoreDeps = {},
): SnapshotStore {
  const index = createRepo(store, queue, {
    key: SNAPSHOT_INDEX_KEY,
    version: SNAPSHOT_INDEX_VERSION,
    schema: SnapshotIndex,
    defaults: (): SnapshotIndex => [],
  });
  const conversation = (id: string) =>
    createRepo(store, queue, {
      key: snapshotKey(id),
      version: SNAPSHOT_VERSION,
      schema: Snapshot,
      defaults: (): Snapshot => ({ pageKey: '', messages: [], updatedAt: 0, truncated: false }),
    });
  const find = (entries: SnapshotIndex, tabId: number, pageKey: string) =>
    entries.find((entry) => entry.tabId === tabId && entry.pageKey === pageKey);

  return {
    get(tabId, pageKey) {
      return queue(async () => {
        const entry = find((await index.read()).value, tabId, pageKey);
        if (entry === undefined) return { status: 'none' };
        if (entry.evicted) return { status: 'evicted' };

        const read = await conversation(entry.id).read();
        if (read.status !== 'ok') return { status: 'none' };
        await index.updateUnqueued((entries) =>
          entries.map((item) => (item.id === entry.id ? { ...item, usedAt: now() } : item)),
        );
        return { status: 'found', messages: read.value.messages, truncated: read.value.truncated };
      });
    },

    save(tabId, pageKey, messages) {
      return queue(async () => {
        const at = now();
        const entries = (await index.read()).value;
        const existing = find(entries, tabId, pageKey);
        const id = existing?.id ?? newId();

        const fitted = fitPage(pageKey, messages, at, limits.pageBytes);
        if (fitted === null) throw new SnapshotTooLargeError();

        // Make room: the least recently used conversations go first, whatever
        // tab they belong to (§4.4, decision 2).
        const others = entries.filter((entry) => entry !== existing);
        let total = fitted.bytes + others.reduce((sum, entry) => sum + entry.bytes, 0);
        const evicted = new Set<string>();
        for (const entry of others
          .filter((item) => !item.evicted)
          .sort((a, b) => a.usedAt - b.usedAt)) {
          if (total <= limits.totalBytes) break;
          evicted.add(entry.id);
          total -= entry.bytes;
        }

        const entry: SnapshotIndexEntry = {
          id,
          tabId,
          pageKey,
          usedAt: at,
          bytes: fitted.bytes,
          evicted: false,
        };
        const kept = others.map((item) =>
          evicted.has(item.id) ? { ...item, usedAt: at, bytes: 0, evicted: true } : item,
        );

        for (const gone of evicted) await conversation(gone).removeUnqueued();
        await index.updateUnqueued(() => forgetOldEvicted([...kept, entry], limits.evictedLimit));
        try {
          await conversation(id).updateUnqueued(() => fitted.snapshot);
        } catch (error) {
          // The conversation is not saved: let the index say so again. If even
          // that fails, the entry reads as nothing saved, which is the truth.
          await index
            .updateUnqueued(() =>
              forgetOldEvicted(
                existing === undefined ? kept : [...kept, existing],
                limits.evictedLimit,
              ),
            )
            .catch(() => undefined);
          throw error;
        }
        return { truncated: fitted.snapshot.truncated };
      });
    },

    removeTab(tabId) {
      return queue(async () => {
        const gone = (await index.read()).value.filter((entry) => entry.tabId === tabId);
        if (gone.length === 0) return;
        for (const entry of gone) {
          if (!entry.evicted) await conversation(entry.id).removeUnqueued();
        }
        await index.updateUnqueued((entries) => entries.filter((entry) => entry.tabId !== tabId));
      });
    },
  };
}

/** Size of a stored value, as UTF-8 JSON. */
export function byteSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/**
 * The snapshot of `messages`, within `limit` bytes: the oldest exchanges are
 * dropped until it fits, so the conversation still begins with an answer
 * (§4.4, decision 2). Null when not even the latest answer fits.
 */
export function fitPage(
  pageKey: string,
  messages: readonly SnapshotMessage[],
  updatedAt: number,
  limit: number,
): { snapshot: Snapshot; bytes: number } | null {
  // Sizes are added up rather than measured again for each attempt: a JSON
  // array is its items, the commas between them, and what surrounds it.
  const sizes = messages.map(byteSize);
  const empty = (truncated: boolean) => byteSize({ pageKey, messages: [], updatedAt, truncated });
  let rest = sizes.reduce((sum, size) => sum + size, 0);

  for (let start = 0; start < messages.length;) {
    const count = messages.length - start;
    const bytes = empty(start > 0) + rest + (count - 1);
    if (bytes <= limit) {
      const snapshot = {
        pageKey,
        messages: messages.slice(start),
        updatedAt,
        truncated: start > 0,
      };
      return { snapshot, bytes };
    }
    do {
      rest -= sizes[start] ?? 0;
      start += 1;
    } while (start < messages.length && messages[start]?.role !== 'assistant');
  }
  return null;
}

/** Keeps the newest evicted entries, so the index cannot grow without end. */
function forgetOldEvicted(entries: SnapshotIndex, limit: number): SnapshotIndex {
  const evicted = entries.filter((entry) => entry.evicted);
  if (evicted.length <= limit) return entries;
  const forgotten = new Set(
    evicted.sort((a, b) => a.usedAt - b.usedAt).slice(0, evicted.length - limit),
  );
  return entries.filter((entry) => !forgotten.has(entry));
}
