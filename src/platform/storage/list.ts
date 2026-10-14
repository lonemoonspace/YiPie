import { z } from 'zod';
import type { RecordDefinition } from './repo';

/** A stored list as read: the rows this version understands, and the rest. */
export interface ListValue<T> {
  items: T[];
  /**
   * Rows that do not match the row schema. They take no part in anything and
   * are never shown, but they are written back unchanged, after the readable
   * rows: nothing a user stored is dropped (docs/development-plan.md §7).
   */
  unrecognized: unknown[];
}

/**
 * The parts of a `RecordDefinition` for a list stored as an array of rows.
 * Each row is read on its own, so one bad row no longer makes the whole list
 * unreadable; only a value that is not an array at all still does, and goes
 * to quarantine before it is replaced.
 */
export function listRecord<T>(
  row: z.ZodType<T>,
): Pick<RecordDefinition<ListValue<T>>, 'schema' | 'encode' | 'defaults'> {
  return {
    schema: z.array(z.unknown()).transform((rows) => {
      const value: ListValue<T> = { items: [], unrecognized: [] };
      for (const raw of rows) {
        const parsed = row.safeParse(raw);
        if (parsed.success) value.items.push(parsed.data);
        else value.unrecognized.push(raw);
      }
      return value;
    }),
    encode: (value) => [...value.items.map((item) => row.parse(item)), ...value.unrecognized],
    defaults: () => ({ items: [], unrecognized: [] }),
  };
}
