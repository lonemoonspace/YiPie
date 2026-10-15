import type { MoveDirection } from '@/contract/mutations';
import type { ListView } from '@/contract/rpc';
import {
  SELECTION_KEY,
  SELECTION_VERSION,
  Selection,
  defaultSelection,
  type SelectionField,
} from '@/contract/selection';
import {
  defaultAfterChange,
  effectiveDefault,
  moveItem,
  removeItem,
  updateItem,
} from '@/domain/list-mutations';
import { createLogger } from '@/platform/logger';
import {
  ReadOnlyRecordError,
  createListRepo,
  createRepo,
  storedVersionOf,
  type ListDefinition,
  type Queue,
  type RecordDefinition,
  type Rows,
  type StorageLike,
} from '@/platform/storage';
import { NotFoundError } from './errors';

const logger = createLogger('settings');

/** The record that holds the default of every list. */
export const SELECTION_RECORD: RecordDefinition<Selection> = {
  key: SELECTION_KEY,
  version: SELECTION_VERSION,
  schema: Selection,
  defaults: defaultSelection,
};

/**
 * The changes a list offers (docs/development-plan.md §4.3, decision 1). Each
 * runs in the shared write queue; an id that is not in the list is refused
 * with `NotFoundError`.
 */
export interface ConfigListService<T, Draft, Patch> {
  list(): Promise<ListView<T>>;
  /** Appends an item with a fresh id. */
  add(draft: Draft): Promise<ListView<T>>;
  /** Appends every item, each with a fresh id, in one change (an import). */
  addAll(drafts: readonly Draft[]): Promise<ListView<T>>;
  /** Changes only the fields named in `patch`. */
  update(id: string, patch: Patch): Promise<ListView<T>>;
  remove(id: string): Promise<ListView<T>>;
  move(id: string, direction: MoveDirection): Promise<ListView<T>>;
  setDefault(id: string): Promise<ListView<T>>;
}

export interface ConfigListOptions<T extends { id: string }, Draft> {
  /** Names an item in errors and logs, e.g. "model configuration". */
  what: string;
  list: ListDefinition<T>;
  /** Where the selection record keeps this list's default. */
  selectionField: SelectionField;
  create: (draft: Draft, id: string) => T;
  newId: () => string;
  /**
   * Runs once a change is written, still in its slot of the queue, with every
   * stored row before and after the change (unrecognized rows included). It
   * must not throw: the change has already happened.
   */
  afterChange?: (before: readonly unknown[], after: readonly unknown[]) => Promise<void>;
}

/**
 * A list of configurations with a default (models, prompts). The list and its
 * default live in two records; a change that moves the default writes both in
 * one slot of the write queue, so nothing interleaves between them.
 */
export function createConfigListService<T extends { id: string }, Draft, Patch extends Partial<T>>(
  store: StorageLike,
  queue: Queue,
  options: ConfigListOptions<T, Draft>,
): ConfigListService<T, Draft, Patch> {
  const rows = createListRepo(store, queue, options.list);
  const selection = createRepo(store, queue, SELECTION_RECORD);
  const field = options.selectionField;

  const toView = (
    current: Rows<T>,
    selected: string | null,
    state: Omit<ListView<T>, 'items' | 'defaultId' | 'unrecognized'>,
  ): ListView<T> => ({
    items: current.items,
    defaultId: effectiveDefault(current.items, selected)?.id ?? null,
    unrecognized: current.unrecognized.length,
    ...state,
  });

  /** Applies `edit` to the items, keeping the default where it belongs. */
  const change = (edit: (items: T[]) => T[] | null, id: string | null) =>
    queue(async () => {
      const choice = await selection.read();
      const stored = choice.value[field];
      let before: T[] = [];
      let next = { id: stored, fellBack: false };
      let pin = false;

      const written = await rows.updateUnqueued((items) => {
        const after = edit(items);
        if (after === null) throw new NotFoundError(options.what, id ?? '');
        before = items;
        next = defaultAfterChange(items, stored, after);
        // The default is stored only when this change would otherwise move it.
        pin = next.id !== (effectiveDefault(after, stored)?.id ?? null);
        if (pin && choice.status === 'invalid' && choice.readOnly) {
          // Refused before anything is written, rather than half done.
          throw new ReadOnlyRecordError(SELECTION_KEY, storedVersionOf(choice.raw));
        }
        return after;
      });

      let selected = stored;
      let quarantined = written.quarantined;
      if (pin) {
        const saved = await selection.updateUnqueued((current) => ({
          ...current,
          [field]: next.id,
        }));
        selected = next.id;
        quarantined ||= saved.quarantined;
      }

      if (options.afterChange) {
        const kept = written.value.unrecognized;
        try {
          await options.afterChange([...before, ...kept], [...written.value.items, ...kept]);
        } catch (error) {
          logger.error(`After changing a ${options.what}:`, error);
        }
      }

      return toView(written.value, selected, {
        status: 'ok',
        readOnly: false,
        quarantined,
        defaultFellBack: next.fellBack,
        defaultUnreadable: !pin && choice.status === 'invalid' && !choice.readOnly,
      });
    });

  return {
    async list() {
      const [read, choice] = await Promise.all([rows.read(), selection.read()]);
      if (read.status === 'invalid') {
        // An unreadable list is shown as its defaults, so the reason must be on record.
        logger.warn(`The ${options.what} list is unreadable:`, read.reason, read.issues);
      }
      if (choice.status === 'invalid') {
        logger.warn('The default selection is unreadable:', choice.reason, choice.issues);
      }
      return toView(read.value, choice.value[field], {
        status: read.status,
        readOnly: read.status === 'invalid' && read.readOnly,
        quarantined: false,
        defaultFellBack: false,
        defaultUnreadable: choice.status === 'invalid' && !choice.readOnly,
      });
    },

    add(draft) {
      const item = options.create(draft, options.newId());
      return change((items) => [...items, item], null);
    },
    addAll(drafts) {
      const added = drafts.map((draft) => options.create(draft, options.newId()));
      return change((items) => [...items, ...added], null);
    },
    update: (id, patch) => change((items) => updateItem(items, id, patch), id),
    remove: (id) => change((items) => removeItem(items, id), id),
    move: (id, direction) => change((items) => moveItem(items, id, direction), id),

    setDefault(id) {
      return queue(async () => {
        const read = await rows.read();
        if (!read.value.items.some((item) => item.id === id)) {
          throw new NotFoundError(options.what, id);
        }
        // A list a newer version wrote is read-only as a whole, its default
        // included: that version may read the default differently.
        if (read.status === 'invalid' && read.readOnly) {
          throw new ReadOnlyRecordError(options.list.key, storedVersionOf(read.raw));
        }
        const saved = await selection.updateUnqueued((current) => ({ ...current, [field]: id }));
        return toView(read.value, id, {
          status: read.status,
          readOnly: false,
          quarantined: saved.quarantined,
          defaultFellBack: false,
          defaultUnreadable: false,
        });
      });
    },
  };
}
