import { z } from 'zod';
import type { StorageKey } from '@/contract/storage';
import { createRepo, type ReadResult, type UpdateResult } from './repo';
import type { Queue } from './tx';
import type { StorageLike } from './types';

/** A record that stores a list of rows, each with an id (docs/development-plan.md §7). */
export interface ListDefinition<T extends { id: string }> {
  key: StorageKey;
  /** Schema version written into the envelope. */
  version: number;
  /** One row. A row that fails it is set aside, never used and never changed. */
  row: z.ZodType<T>;
  /** Rows shown when the key is missing or unreadable as a whole; fresh objects each call. */
  defaults: () => T[];
  /** As on `RecordDefinition`: turns the whole stored list of an older version into the current shape. */
  upgrade?: (data: unknown, fromVersion: number) => unknown;
}

/**
 * A list as read. `items` are the rows this version understands, in stored
 * order. `unrecognized` holds the rest: a row a newer version wrote, a damaged
 * row, a second row with an id already seen. They take part in nothing, the
 * settings page does not show them, and every write puts them back unchanged
 * after the items.
 */
export interface Rows<T> {
  items: T[];
  unrecognized: unknown[];
}

export interface ListRepo<T> {
  read(): Promise<ReadResult<Rows<T>>>;
  /** Read-modify-write of the items in the shared queue; unrecognized rows are kept. */
  update(change: (items: T[]) => T[]): Promise<UpdateResult<Rows<T>>>;
  /** `update` for a task that already runs in the queue (see `Repo.updateUnqueued`). */
  updateUnqueued(change: (items: T[]) => T[]): Promise<UpdateResult<Rows<T>>>;
}

/**
 * A list read row by row. One bad row no longer makes the whole value
 * unreadable: only a value that is not a list at all is (and is then backed up
 * before the next write, like any other record).
 */
export function createListRepo<T extends { id: string }>(
  store: StorageLike,
  queue: Queue,
  definition: ListDefinition<T>,
): ListRepo<T> {
  const record = createRepo<unknown[]>(store, queue, {
    key: definition.key,
    version: definition.version,
    schema: z.array(z.unknown()),
    defaults: definition.defaults,
    upgrade: definition.upgrade,
  });

  const split = (rows: readonly unknown[]) => splitRows(rows, definition.row);

  const write = (current: unknown[], change: (items: T[]) => T[]): unknown[] => {
    const { items, unrecognized } = split(current);
    const next = change(items).map((item) => definition.row.parse(item));
    const ids = new Set(next.map((item) => item.id));
    if (ids.size !== next.length) throw new Error(`Two rows of ${definition.key} share an id.`);
    return [...next, ...unrecognized];
  };

  const withRows = ({ value, quarantined }: UpdateResult<unknown[]>) => ({
    value: split(value),
    quarantined,
  });

  return {
    async read() {
      const result = await record.read();
      return { ...result, value: split(result.value) };
    },
    async update(change) {
      return withRows(await record.update((current) => write(current, change)));
    },
    async updateUnqueued(change) {
      return withRows(await record.updateUnqueued((current) => write(current, change)));
    },
  };
}

/** Sorts stored rows into the ones `row` reads and the ones set aside. */
export function splitRows<T extends { id: string }>(
  rows: readonly unknown[],
  row: z.ZodType<T>,
): Rows<T> {
  const items: T[] = [];
  const unrecognized: unknown[] = [];
  const seen = new Set<string>();
  for (const raw of rows) {
    const parsed = row.safeParse(raw);
    if (parsed.success && !seen.has(parsed.data.id)) {
      seen.add(parsed.data.id);
      items.push(parsed.data);
    } else {
      unrecognized.push(raw);
    }
  }
  return { items, unrecognized };
}
