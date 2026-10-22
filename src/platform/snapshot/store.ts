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
import { createLogger } from '@/platform/logger';
import { createRepo, type Queue, type StorageLike } from '@/platform/storage';

const logger = createLogger('snapshot');

export type SnapshotLookup =
  | { status: 'found'; messages: SnapshotMessage[]; truncated: boolean }
  /** Nothing was saved for this page in this tab. */
  | { status: 'none' }
  /** A conversation was saved, then evicted to make room for others. */
  | { status: 'evicted' };

export interface SnapshotSaved {
  /**
   * False when this save was not stored: a newer save from the same panel
   * was stored already, or the panel is no longer the one attached in its tab.
   */
  stored: boolean;
  /** The oldest messages did not fit the page's limit and were left out. */
  truncated: boolean;
}

/** Which save this is: the panel document that sent it, and that panel's count of its saves. */
export interface SnapshotRevision {
  documentId: string;
  revision: number;
}

export interface SnapshotStore {
  /**
   * The conversation saved for `pageKey` in `tabId`. Restoring it counts as
   * using it. An empty conversation (the user started over) reads as none.
   */
  get(tabId: number, pageKey: string): Promise<SnapshotLookup>;
  /**
   * Saves the whole conversation, replacing what was saved for the page
   * before, unless the same panel already stored a newer one or the panel is
   * no longer the one attached in the tab.
   */
  save(
    tabId: number,
    pageKey: string,
    messages: SnapshotMessage[],
    revision: SnapshotRevision,
  ): Promise<SnapshotSaved>;
  /** Deletes every conversation of a tab that was closed. */
  removeTab(tabId: number): Promise<void>;
}

export interface SnapshotLimits {
  totalBytes: number;
  pageBytes: number;
  evictedLimit: number;
}

export interface SnapshotStoreDeps {
  /**
   * Whether `documentId` is the panel attached in `tabId` now (the panel
   * registry). A save asks once its turn in the write queue comes: the
   * dispatcher asked before the request waited there, and meanwhile a new
   * panel may have attached (the page was reloaded, the panel mounted again)
   * or the tab may have closed (PR #4 review).
   */
  attached: (tabId: number, documentId: string) => Promise<boolean>;
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
 * A save leaves what it replaces alone until it is complete. It writes the
 * conversation under a new key, then one write of the index points the page
 * at that key and lists what it replaced and what it evicted as garbage;
 * only then are those deleted. Failed or stopped at any step, the store
 * holds the conversations from before the save or the ones after it, whole,
 * and the index says which. A key is in the index (an entry points at it, or
 * it is listed as garbage) before it is written, so none holds memory
 * unaccounted for; what a save could not delete goes with the next one.
 */
export function createSnapshotStore(
  store: StorageLike,
  queue: Queue,
  {
    attached,
    newId = () => crypto.randomUUID(),
    now = () => Date.now(),
    limits = DEFAULT_LIMITS,
  }: SnapshotStoreDeps,
): SnapshotStore {
  const index = createRepo(store, queue, {
    key: SNAPSHOT_INDEX_KEY,
    version: SNAPSHOT_INDEX_VERSION,
    schema: SnapshotIndex,
    defaults: (): SnapshotIndex => ({ entries: [], garbage: [] }),
  });
  const conversation = (id: string) =>
    createRepo(store, queue, {
      key: snapshotKey(id),
      version: SNAPSHOT_VERSION,
      schema: Snapshot,
      defaults: (): Snapshot => ({ pageKey: '', messages: [], updatedAt: 0, truncated: false }),
    });
  const find = (entries: readonly SnapshotIndexEntry[], tabId: number, pageKey: string) =>
    entries.find((entry) => entry.tabId === tabId && entry.pageKey === pageKey);

  /** Deletes the keys listed as garbage, then the listing. Inside a queued task. */
  const collect = async () => {
    const { garbage } = (await index.read()).value;
    if (garbage.length === 0) return;
    for (const id of garbage) await conversation(id).removeUnqueued();
    await index.updateUnqueued((current) => ({
      ...current,
      garbage: current.garbage.filter((id) => !garbage.includes(id)),
    }));
  };

  return {
    get(tabId, pageKey) {
      return queue(async () => {
        const entry = find((await index.read()).value.entries, tabId, pageKey);
        if (entry === undefined) return { status: 'none' };
        if (entry.evicted) return { status: 'evicted' };

        const read = await conversation(entry.id).read();
        // Unreadable is not the same as never saved: the panel summarizes
        // anew either way, but the log says why. The entry stays, so the
        // order of this panel's saves still holds.
        if (read.status === 'invalid') {
          logger.warn('A saved conversation is unreadable:', read.reason, read.issues);
        }
        if (read.status !== 'ok' || read.value.messages.length === 0) return { status: 'none' };
        await index.updateUnqueued((current) => ({
          ...current,
          entries: current.entries.map((item) =>
            item.id === entry.id ? { ...item, usedAt: now() } : item,
          ),
        }));
        return { status: 'found', messages: read.value.messages, truncated: read.value.truncated };
      });
    },

    save(tabId, pageKey, messages, { documentId, revision }) {
      return queue(async () => {
        // Asked here, in the queue, where attaching a panel and closing a tab
        // take their turns too. A save from a panel that is no longer the one
        // attached would overwrite what the new panel saved, or bring back
        // the conversation of a closed tab.
        if (!(await attached(tabId, documentId))) return { stored: false, truncated: false };
        // First what an earlier save left behind: the worker stopped before
        // it could delete, or deleting failed.
        await collect();
        const at = now();
        const { entries } = (await index.read()).value;
        const existing = find(entries, tabId, pageKey);
        // Saves from one panel may arrive in any order: a later one may have
        // been sent while an earlier one was still on its way. The newest
        // stands. A save from another panel document (the page was reloaded,
        // the panel mounted again) counts: that panel is the one attached
        // now, so whatever was saved before came from an earlier one.
        if (existing?.documentId === documentId && existing.revision >= revision) {
          return { stored: false, truncated: false };
        }

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

        const id = newId();
        const entry: SnapshotIndexEntry = {
          id,
          tabId,
          pageKey,
          usedAt: at,
          bytes: fitted.bytes,
          evicted: false,
          documentId,
          revision,
        };
        const kept = others.map((item) =>
          evicted.has(item.id) ? { ...item, usedAt: at, bytes: 0, evicted: true } : item,
        );
        // What the new conversation replaces: the page's earlier one and the
        // ones evicted to make room. An evicted entry's key is gone already.
        const replaced = [...evicted];
        if (existing !== undefined && !existing.evicted) replaced.push(existing.id);

        try {
          // Listed before it exists: should the worker stop after writing
          // it, the next save still knows to delete it.
          await index.updateUnqueued((current) => ({
            ...current,
            garbage: [...current.garbage, id],
          }));
          // Nothing points at it yet: the page still reads as before.
          await conversation(id).updateUnqueued(() => fitted.snapshot);
          // The commit, in one write: the page now reads the new key, and
          // what it replaced is garbage.
          await index.updateUnqueued((current) => ({
            entries: forgetOldEvicted([...kept, entry], limits.evictedLimit),
            garbage: [...current.garbage.filter((item) => item !== id), ...replaced],
          }));
        } catch (error) {
          // Not saved, and nothing that was saved before has been touched.
          // The new key goes now, or with the next save if this fails too.
          await collect().catch(() => undefined);
          throw error;
        }
        // Saved, whatever happens here: what cannot be deleted now is still
        // listed, and goes with the next save.
        await collect().catch(() => undefined);
        return { stored: true, truncated: fitted.snapshot.truncated };
      });
    },

    removeTab(tabId) {
      return queue(async () => {
        const gone = (await index.read()).value.entries.filter((entry) => entry.tabId === tabId);
        if (gone.length === 0) return;
        // One write forgets the tab and lists its conversations as garbage.
        await index.updateUnqueued((current) => ({
          entries: current.entries.filter((entry) => entry.tabId !== tabId),
          garbage: [
            ...current.garbage,
            ...gone.filter((entry) => !entry.evicted).map((entry) => entry.id),
          ],
        }));
        await collect();
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
 * (§4.4, decision 2). Null when not even the latest answer fits. No messages
 * make an empty snapshot: the user started over.
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
  if (messages.length === 0) {
    return {
      snapshot: { pageKey, messages: [], updatedAt, truncated: false },
      bytes: empty(false),
    };
  }
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
function forgetOldEvicted(entries: SnapshotIndexEntry[], limit: number): SnapshotIndexEntry[] {
  const evicted = entries.filter((entry) => entry.evicted);
  if (evicted.length <= limit) return entries;
  const forgotten = new Set(
    evicted.sort((a, b) => a.usedAt - b.usedAt).slice(0, evicted.length - limit),
  );
  return entries.filter((entry) => !forgotten.has(entry));
}
