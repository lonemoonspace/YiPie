/**
 * Changes to the user's lists (models, prompts) and what they do to the
 * default item (docs/development-plan.md §4.3). Pure: the services run them
 * inside the write queue and store the result.
 */

export interface Identified {
  id: string;
}

/**
 * The item in effect as the default: the stored default if it is still in the
 * list, otherwise the first item, otherwise none. A stale id is harmless.
 */
export function resolveDefault<T extends Identified>(
  items: readonly T[],
  defaultId: string | null,
): T | null {
  return items.find((item) => item.id === defaultId) ?? items[0] ?? null;
}

/** The default was removed, and `to` (or nothing, for an empty list) took its place. */
export interface Fallback<T> {
  from: T;
  to: T | null;
}

export interface Settled<T> {
  /** The default to store after the change. */
  defaultId: string | null;
  /** Set when the change removed the default, so the user can be told. */
  fallback: Fallback<T> | null;
}

/**
 * The default after a change from `before` to `after`. The item in effect
 * before keeps the role while it exists. Otherwise the role falls back to the
 * first item. Starting from the item in effect, not the stored id, keeps a
 * fallen-back default where it is when the list is later reordered.
 */
export function settleDefault<T extends Identified>(
  before: readonly T[],
  after: readonly T[],
  defaultId: string | null,
): Settled<T> {
  const previous = resolveDefault(before, defaultId);
  if (previous !== null && after.some((item) => item.id === previous.id)) {
    return { defaultId: previous.id, fallback: null };
  }
  const next = after[0] ?? null;
  return {
    defaultId: next?.id ?? null,
    fallback: previous === null ? null : { from: previous, to: next },
  };
}

/** The list with `change` applied to the item `id`; `null` when there is no such item. */
export function updateItem<T extends Identified>(
  items: readonly T[],
  id: string,
  change: (item: T) => T,
): T[] | null {
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return null;
  return items.map((item, i) => (i === index ? change(item) : item));
}

/** The list without the item `id`; `null` when there is no such item. */
export function removeItem<T extends Identified>(items: readonly T[], id: string): T[] | null {
  if (!items.some((item) => item.id === id)) return null;
  return items.filter((item) => item.id !== id);
}

/**
 * The list with the item `id` at position `to`, counted in the list without
 * it; a position past the end means last. `null` when there is no such item.
 */
export function moveItem<T extends Identified>(
  items: readonly T[],
  id: string,
  to: number,
): T[] | null {
  const item = items.find((candidate) => candidate.id === id);
  if (item === undefined) return null;
  const rest = items.filter((candidate) => candidate.id !== id);
  const position = Math.min(Math.max(to, 0), rest.length);
  return [...rest.slice(0, position), item, ...rest.slice(position)];
}
