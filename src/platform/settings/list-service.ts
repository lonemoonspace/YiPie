import type { z } from 'zod';
import {
  SELECTION_KEY,
  SELECTION_VERSION,
  Selection,
  defaultSelection,
} from '@/contract/selection';
import type { StorageKey } from '@/contract/storage';
import {
  moveItem,
  removeItem,
  resolveDefault,
  settleDefault,
  updateItem,
  type Fallback,
  type Identified,
} from '@/domain/list-mutations';
import { applyPatch } from '@/domain/patch';
import { createLogger } from '@/platform/logger';
import { createRepo, listRecord, type Queue, type StorageLike } from '@/platform/storage';
import { NotFoundError } from './errors';

const logger = createLogger('lists');

/** The default a list owns in the selection record. */
export type SelectionField = 'defaultModelId' | 'defaultPromptId';

export interface ListView<T> {
  items: T[];
  /** The default in effect: the stored one, or the first item; `null` for an empty list. */
  defaultId: string | null;
  status: 'ok' | 'missing' | 'invalid';
  readOnly: boolean;
  /** This change replaced an unreadable list, which was backed up first. */
  quarantined: boolean;
}

export interface ListChange<T> {
  view: ListView<T>;
  /** The readable items before the change. */
  before: T[];
  /** Set when the change removed the default, so the user can be told where it went. */
  fallback: Fallback<T> | null;
}

export interface ListDefinition<T, Draft> {
  key: StorageKey;
  version: number;
  row: z.ZodType<T>;
  selectionField: SelectionField;
  /** For error messages: "model configuration", "prompt". */
  noun: string;
  /** A new item from what the settings page submitted, with a fresh id. */
  create: (draft: Draft, id: string) => T;
}

export interface ListService<T, Draft, Patch> {
  view(): Promise<ListView<T>>;
  add(draft: Draft): Promise<ListChange<T>>;
  /** Changes only the fields named in `patch`. */
  update(id: string, patch: Patch): Promise<ListChange<T>>;
  remove(id: string): Promise<ListChange<T>>;
  move(id: string, to: number): Promise<ListChange<T>>;
  /** Resolves to the new default's id. */
  setDefault(id: string): Promise<string>;
  /** Writes `items` when the list was never written (a missing key); resolves to whether it did. */
  seed(items: () => T[]): Promise<boolean>;
}

/**
 * A user's list of items plus its default (docs/development-plan.md §4.3).
 * Every change is one task in the write queue: read the list, apply one
 * mutation, write it back, then settle the default in the same task. Nothing
 * can replace the list wholesale, so a row added meanwhile is never lost.
 */
export function createListService<T extends Identified, Draft, Patch extends Partial<T>>(
  store: StorageLike,
  queue: Queue,
  definition: ListDefinition<T, Draft>,
  newId: () => string = () => crypto.randomUUID(),
): ListService<T, Draft, Patch> {
  const list = createRepo(store, queue, {
    key: definition.key,
    version: definition.version,
    ...listRecord(definition.row),
  });
  const selection = createRepo(store, queue, {
    key: SELECTION_KEY,
    version: SELECTION_VERSION,
    schema: Selection,
    defaults: defaultSelection,
  });
  const field = definition.selectionField;
  const notFound = (id: string): never => {
    throw new NotFoundError(definition.noun, id);
  };

  /** Runs inside the queue: applies one change, then moves the default if it has to. */
  async function changeLocked(apply: (items: T[]) => T[]): Promise<ListChange<T>> {
    const chosen = await selection.read();
    let before: T[] = [];
    const written = await list.updateLocked((current) => {
      before = current.items;
      return { ...current, items: apply(current.items) };
    });
    const after = written.value.items;
    const stored = chosen.value[field];
    const settled = settleDefault(before, after, stored);
    // A selection written by a newer version stays untouched; the default
    // still resolves when read.
    const readOnly = chosen.status === 'invalid' && chosen.readOnly;
    if (!readOnly && settled.defaultId !== stored) {
      await selection.updateLocked((current) => ({ ...current, [field]: settled.defaultId }));
    }
    return {
      view: {
        items: after,
        defaultId: settled.defaultId,
        status: 'ok',
        readOnly: false,
        quarantined: written.quarantined,
      },
      before,
      fallback: settled.fallback,
    };
  }

  const change = (apply: (items: T[]) => T[]) => queue(() => changeLocked(apply));

  return {
    async view() {
      const [read, chosen] = await Promise.all([list.read(), selection.read()]);
      if (read.status === 'invalid') {
        // Shown as an empty list, so the reason must be on record.
        logger.warn(`The ${definition.noun} list is unreadable:`, read.reason, read.issues);
      }
      return {
        items: read.value.items,
        defaultId: resolveDefault(read.value.items, chosen.value[field])?.id ?? null,
        status: read.status,
        readOnly: read.status === 'invalid' && read.readOnly,
        quarantined: false,
      };
    },

    add: (draft) => change((items) => [...items, definition.create(draft, newId())]),

    update: (id, patch) =>
      change((items) => updateItem(items, id, (item) => applyPatch(item, patch)) ?? notFound(id)),

    remove: (id) => change((items) => removeItem(items, id) ?? notFound(id)),

    move: (id, to) => change((items) => moveItem(items, id, to) ?? notFound(id)),

    setDefault: (id) =>
      queue(async () => {
        const read = await list.read();
        if (!read.value.items.some((item) => item.id === id)) notFound(id);
        await selection.updateLocked((current) => ({ ...current, [field]: id }));
        return id;
      }),

    seed: (items) =>
      queue(async () => {
        if ((await list.read()).status !== 'missing') return false;
        await changeLocked(() => items());
        return true;
      }),
  };
}
