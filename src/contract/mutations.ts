import { z } from 'zod';

/**
 * Inputs of the list changes (docs/development-plan.md §4.3, decision 1):
 * add, update (an explicit patch), remove, move, set as default. There is no
 * "save the whole list": the background reads the list, applies one change
 * and writes it back inside its write queue, so a row added meanwhile by
 * another page can never be overwritten.
 */
export const ItemId = z.string().min(1).max(200);

export const MOVE_DIRECTIONS = ['up', 'down'] as const;
export const MoveDirection = z.enum(MOVE_DIRECTIONS);
export type MoveDirection = z.infer<typeof MoveDirection>;

export const RemoveInput = z.strictObject({ id: ItemId });

/** One step towards the top or the bottom; relative, so a list that changed meanwhile still moves the item the user meant. */
export const MoveInput = z.strictObject({ id: ItemId, direction: MoveDirection });

export const SetDefaultInput = z.strictObject({ id: ItemId });

export function updateInput<Patch extends z.ZodType>(patch: Patch) {
  return z.strictObject({ id: ItemId, patch });
}
