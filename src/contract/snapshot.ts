import { z } from 'zod';
import type { StorageKey } from './storage';

/*
 * Conversation snapshots (docs/development-plan.md §4.4, decisions 1–3): what
 * a panel restores when the user triggers it again on a page, after a reload
 * or after closing it. Only the answers and the questions that followed them
 * are kept. The page text and the prompt are not: both are rendered afresh
 * for every request. No credential is ever part of one.
 *
 * They live in `storage.session`: memory only, gone when the browser restarts
 * or the extension updates, readable by extension pages and the service
 * worker alone, written by the service worker alone. Each conversation has
 * its own key, so saving one rewrites only that one; a small index holds
 * what eviction and tab cleanup need.
 */

const Count = z.number().int().nonnegative();

/**
 * Tokens one answer used: what the service reported, or, when it reported
 * nothing, our estimate. Never a mix of the two (docs/development-plan.md
 * §4.4, decision 5).
 */
export const TurnUsage = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('service'),
    input: Count.nullable(),
    output: Count.nullable(),
    total: Count.nullable(),
  }),
  z.object({ source: z.literal('estimate'), input: Count, output: Count }),
]);
export type TurnUsage = z.infer<typeof TurnUsage>;

export const SnapshotMessage = z.discriminatedUnion('role', [
  /** A follow-up question. */
  z.object({ role: z.literal('user'), content: z.string().max(200_000) }),
  z.object({
    role: z.literal('assistant'),
    content: z.string().max(200_000),
    /** The user stopped the answer before it was complete. */
    stopped: z.boolean(),
    usage: TurnUsage.nullable(),
  }),
]);
export type SnapshotMessage = z.infer<typeof SnapshotMessage>;

export const SNAPSHOT_VERSION = 1;

/** One page's conversation in one tab. */
export const Snapshot = z.object({
  pageKey: z.string(),
  messages: z.array(SnapshotMessage),
  updatedAt: z.number(),
  /** The oldest messages were dropped to keep it under `SNAPSHOT_PAGE_BYTES`. */
  truncated: z.boolean(),
});
export type Snapshot = z.infer<typeof Snapshot>;

/** Where the conversation with index entry `id` is stored. */
export function snapshotKey(id: string): StorageKey {
  return `session:snapshot:${id}`;
}

export const SNAPSHOT_INDEX_KEY = 'session:snapshots' satisfies StorageKey;
export const SNAPSHOT_INDEX_VERSION = 1;

export const SnapshotIndexEntry = z.object({
  id: z.string().min(1),
  tabId: z.number().int(),
  pageKey: z.string(),
  /** When the conversation was last saved or restored: eviction goes by it. */
  usedAt: z.number(),
  /** Size of the stored conversation (UTF-8 JSON); zero once evicted. */
  bytes: Count,
  /** Evicted to make room for others. Remembered so the panel can say so. */
  evicted: z.boolean(),
  /**
   * Which save is stored: the panel document that sent it (its `documentId`)
   * and that panel's count of its saves. A save from the same panel with a
   * lower count arrived late and is ignored, so the newest one stands
   * whatever order they come in (PR #4 review).
   */
  documentId: z.string().default(''),
  revision: Count.default(0),
});
export type SnapshotIndexEntry = z.infer<typeof SnapshotIndexEntry>;

export const SnapshotIndex = z.array(SnapshotIndexEntry);
export type SnapshotIndex = z.infer<typeof SnapshotIndex>;

/**
 * Bytes all conversations may take together. `storage.session` holds 10 MB
 * for the whole extension, shared by every tab, so the budget is global and
 * the least recently used conversations make room (§4.4, decision 2).
 */
export const SNAPSHOT_TOTAL_BYTES = 6_000_000;

/** Bytes one page's conversation may take; beyond it, the oldest messages go. */
export const SNAPSHOT_PAGE_BYTES = 512_000;

/** Evicted conversations remembered at most; the oldest are forgotten first. */
export const SNAPSHOT_EVICTED_LIMIT = 200;
