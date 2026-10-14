import type { MoveDirection } from '@/contract/mutations';
import { applyPatch } from '@/domain/patch';

/**
 * Changes to a list of configurations (models, prompts), as pure functions.
 * Each returns the new list, or `null` when the id is not in it; the caller
 * decides what a missing id means.
 */
interface Identified {
  id: string;
}

export function updateItem<T extends Identified>(
  items: readonly T[],
  id: string,
  patch: Partial<T>,
): T[] | null {
  if (!items.some((item) => item.id === id)) return null;
  return items.map((item) => (item.id === id ? applyPatch(item, patch) : item));
}

export function removeItem<T extends Identified>(items: readonly T[], id: string): T[] | null {
  if (!items.some((item) => item.id === id)) return null;
  return items.filter((item) => item.id !== id);
}

/** Swaps the item with its neighbour; at either end it stays where it is. */
export function moveItem<T extends Identified>(
  items: readonly T[],
  id: string,
  direction: MoveDirection,
): T[] | null {
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return null;
  const target = direction === 'up' ? index - 1 : index + 1;
  const next = [...items];
  const [item, neighbour] = [next[index], next[target]];
  if (item === undefined || neighbour === undefined) return next;
  next[target] = item;
  next[index] = neighbour;
  return next;
}

/**
 * The item in use: the selected one while it exists, otherwise the first.
 * `selected` can name an item that is gone (its row was damaged, say), and
 * nothing has been selected yet after an upgrade from phase 1; both fall back
 * to the first item rather than to nothing.
 */
export function effectiveDefault<T extends Identified>(
  items: readonly T[],
  selected: string | null,
): T | null {
  return items.find((item) => item.id === selected) ?? items[0] ?? null;
}

export interface DefaultAfterChange {
  /** The default to store: unchanged unless the default item was removed. */
  id: string | null;
  /** The default item was removed, so the first one (or none) took its place. */
  fellBack: boolean;
}

/**
 * Where the default goes when the list changes (docs/development-plan.md §4.3,
 * decision 4). The item that was the default stays the default as long as it
 * exists, also when the list is reordered; storing it pins it, so moving
 * another item to the top never changes the default behind the user's back.
 * When it was removed, the first item takes over, or none if the list is
 * empty, and `fellBack` says so.
 */
export function defaultAfterChange<T extends Identified>(
  before: readonly T[],
  selected: string | null,
  after: readonly T[],
): DefaultAfterChange {
  const previous = effectiveDefault(before, selected);
  if (previous !== null && after.some((item) => item.id === previous.id)) {
    return { id: previous.id, fellBack: false };
  }
  return { id: after[0]?.id ?? null, fellBack: previous !== null };
}
