import { useState, type ReactNode } from 'react';
import type { MoveDirection } from '@/contract/mutations';
import type { ListView } from '@/contract/rpc';
import { t } from '@/domain/i18n';
import { defaultAfterChange } from '@/domain/list-mutations';
import { ItemRow, ListNotices } from './list-parts';
import type { ConfigList } from './use-config-list';

/** Which list: picks its messages (`model.removed`, `prompt.removed`…). */
export type ListKind = 'model' | 'prompt';

/** The changes a row offers, as RPCs. */
export interface ListCalls<T> {
  remove(id: string): Promise<ListView<T>>;
  move(id: string, direction: MoveDirection): Promise<ListView<T>>;
  setDefault(id: string): Promise<ListView<T>>;
}

export interface EditorControls {
  /** Moves focus into the editor when it opens; not on page load. */
  focusOnOpen: boolean;
  /** Closes the editor, after a successful save. */
  close: () => void;
  /** Absent when there is nothing to go back to (the list is empty). */
  cancel?: () => void;
}

interface EditableListProps<T extends { id: string }> {
  kind: ListKind;
  view: ListView<T>;
  change: ConfigList<T>['change'];
  busy: boolean;
  calls: ListCalls<T>;
  nameOf: (item: T) => string;
  details: (item: T) => ReactNode;
  badges?: (item: T) => ReactNode;
  actions?: (item: T) => ReactNode;
  /** The form for `item`, or for a new item when it is null. */
  editor: (item: T | null, controls: EditorControls) => ReactNode;
}

/**
 * What is open for editing: nothing, a new item, or an existing one. An
 * existing one is kept as it was when the editor opened: the list may be read
 * again meanwhile (another tab, an import), and the editor fills its form,
 * and works out what the user changed, from the version the user saw.
 */
type Editing<T> = { kind: 'closed' } | { kind: 'new' } | { kind: 'edit'; id: string; original: T };

/**
 * A list of configurations with a default, as the settings page shows it:
 * rows with their changes, one editor at a time (inside its row, or below the
 * list for a new item), and a question before anything is removed that says
 * where the default will go (computed by the same rule the background uses).
 */
export function EditableList<T extends { id: string }>(props: EditableListProps<T>) {
  const { kind, view, change, calls, nameOf } = props;
  const { items, readOnly } = view;
  const [editing, setEditing] = useState<Editing<T>>({ kind: 'closed' });
  const locked = props.busy || readOnly;
  const close = () => setEditing({ kind: 'closed' });
  const nameIn = (among: readonly T[], id: string | null) => {
    const found = among.find((item) => item.id === id);
    return found ? nameOf(found) : '';
  };
  // With nothing in the list yet, the form for a new item is all there is.
  const adding = editing.kind === 'new' || items.length === 0;

  const remove = (item: T) => {
    const name = nameOf(item);
    const after = defaultAfterChange(
      items,
      view.defaultId,
      items.filter((other) => other.id !== item.id),
    );
    const consequence = !after.fellBack
      ? ''
      : after.id === null
        ? t(`${kind}.confirmLast`)
        : t(`${kind}.confirmFallback`, { name: nameIn(items, after.id) });
    if (!window.confirm(`${t(`${kind}.confirmRemove`, { name })}${consequence}`)) return;
    void change(
      () => calls.remove(item.id),
      (next) => {
        const removed = t(`${kind}.removed`, { name });
        if (!next.defaultFellBack) return removed;
        return next.defaultId === null
          ? `${removed}${t(`${kind}.fellBackNone`)}`
          : `${removed}${t(`${kind}.fellBack`, { name: nameIn(next.items, next.defaultId) })}`;
      },
    );
  };

  return (
    <>
      <ListNotices view={view} />
      {items.length > 0 ? (
        <ul className="items" aria-label={t(`${kind}.section`)}>
          {items.map((item, index) => {
            const name = nameOf(item);
            const open = editing.kind === 'edit' && editing.id === item.id ? editing : null;
            return (
              <ItemRow
                key={item.id}
                name={name}
                details={props.details(item)}
                isDefault={item.id === view.defaultId}
                first={index === 0}
                last={index === items.length - 1}
                locked={locked}
                badges={props.badges?.(item)}
                actions={props.actions?.(item)}
                onSetDefault={() =>
                  void change(
                    () => calls.setDefault(item.id),
                    () => t('list.madeDefault', { name }),
                  )
                }
                onEdit={() =>
                  setEditing(
                    open ? { kind: 'closed' } : { kind: 'edit', id: item.id, original: item },
                  )
                }
                onMove={(direction) =>
                  void change(
                    () => calls.move(item.id, direction),
                    () => t(direction === 'up' ? 'list.movedUp' : 'list.movedDown', { name }),
                  )
                }
                onRemove={() => remove(item)}
              >
                {open
                  ? props.editor(open.original, { focusOnOpen: true, close, cancel: close })
                  : null}
              </ItemRow>
            );
          })}
        </ul>
      ) : null}

      {adding ? (
        props.editor(null, {
          focusOnOpen: items.length > 0,
          close,
          cancel: items.length > 0 ? close : undefined,
        })
      ) : (
        <button
          type="button"
          className="add"
          disabled={readOnly}
          onClick={() => setEditing({ kind: 'new' })}
        >
          {t(`${kind}.add`)}
        </button>
      )}
    </>
  );
}
