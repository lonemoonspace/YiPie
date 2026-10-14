import { z } from 'zod';

/**
 * The changes a list accepts (docs/development-plan.md §4.3, decision 1).
 * There is no "replace the whole list": the background reads the list,
 * applies one of these and writes it back inside the write queue, so a row
 * added meanwhile cannot be overwritten.
 */
export const ItemId = z.string().min(1).max(100);

/** Changes the fields named in `patch` of the item `id`. */
export function updateInput<P extends z.ZodType>(patch: P) {
  return z.strictObject({ id: ItemId, patch });
}

export const RemoveInput = z.strictObject({ id: ItemId });

/** Moves the item to position `to` (0 is first); a position past the end means last. */
export const MoveInput = z.strictObject({ id: ItemId, to: z.number().int().min(0) });

export const SetDefaultInput = z.strictObject({ id: ItemId });
