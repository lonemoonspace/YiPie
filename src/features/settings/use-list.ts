import { useCallback, useEffect, useState } from 'react';
import type { FallbackView } from '@/contract/rpc';

/** What every list view carries (contract/rpc). */
export interface ListViewLike<Item> {
  items: Item[];
  defaultId: string | null;
  status: 'ok' | 'missing' | 'invalid';
  readOnly: boolean;
  quarantined: boolean;
}

/** A list view after a change: the fallback when the default was removed. */
export interface ListChangeLike<Item> extends ListViewLike<Item> {
  fallback: FallbackView | null;
}

/** The background calls behind one list; module-level objects, so they stay stable. */
export interface ListApi<Item, View extends ListViewLike<Item>, Change extends View, Form> {
  load(): Promise<View>;
  add(form: Form): Promise<Change>;
  update(id: string, form: Form): Promise<Change>;
  remove(id: string): Promise<Change>;
  move(id: string, to: number): Promise<Change>;
  setDefault(id: string): Promise<{ defaultId: string }>;
}

export type ListNotice<Change> =
  | { kind: 'saved'; quarantined: boolean }
  | { kind: 'removed'; change: Change }
  | { kind: 'failed'; message: string };

/** Which editor is open: one for a new item, or one for the item `id`. */
export type Editing = { mode: 'add' } | { mode: 'edit'; id: string } | null;

export interface ListState<View, Change, Form> {
  view: View | null;
  loadError: string | null;
  editing: Editing;
  /** An operation is in flight; actions are disabled until it ends. */
  busy: boolean;
  /** What the last operation did, for the section to put into words. */
  notice: ListNotice<Change> | null;
  startAdding: () => void;
  startEditing: (id: string) => void;
  stopEditing: () => void;
  /** Saves the open editor: adds, or updates the item being edited. */
  save: (form: Form) => Promise<void>;
  /** Adds an item without an editor, such as a copy of the built-in prompt. */
  add: (form: Form) => Promise<void>;
  remove: (id: string) => Promise<void>;
  move: (id: string, by: -1 | 1) => Promise<void>;
  setDefault: (id: string) => Promise<void>;
}

/**
 * The state of one list on the settings page. Every decision (what the
 * default becomes, which rows stay hidden) comes from the background; this
 * only keeps what to show and which operation is running.
 */
export function useList<
  Item extends { id: string },
  View extends ListViewLike<Item>,
  Change extends View,
  Form,
>(api: ListApi<Item, View, Change, Form>, onBackedUp?: () => void): ListState<View, Change, Form> {
  const [view, setView] = useState<View | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<ListNotice<Change> | null>(null);

  useEffect(() => {
    let active = true;
    api.load().then(
      (loaded) => {
        if (!active) return;
        setView(loaded);
        // With nothing to list, adding the first item is the only thing to do.
        if (loaded.items.length === 0 && !loaded.readOnly) setEditing({ mode: 'add' });
      },
      (error: unknown) => active && setLoadError(messageOf(error)),
    );
    return () => {
      active = false;
    };
  }, [api]);

  const run = useCallback(async (operation: () => Promise<void>) => {
    setBusy(true);
    setNotice(null);
    try {
      await operation();
    } catch (error) {
      setNotice({ kind: 'failed', message: messageOf(error) });
    } finally {
      setBusy(false);
    }
  }, []);

  const applied = useCallback(
    (change: Change) => {
      setView(change);
      if (change.quarantined) onBackedUp?.();
    },
    [onBackedUp],
  );

  return {
    view,
    loadError,
    editing,
    busy,
    notice,
    startAdding: () => {
      setNotice(null);
      setEditing({ mode: 'add' });
    },
    startEditing: (id) => {
      setNotice(null);
      setEditing({ mode: 'edit', id });
    },
    stopEditing: () => setEditing(null),
    save: (form) =>
      run(async () => {
        const change =
          editing?.mode === 'edit' ? await api.update(editing.id, form) : await api.add(form);
        applied(change);
        setEditing(null);
        setNotice({ kind: 'saved', quarantined: change.quarantined });
      }),
    add: (form) =>
      run(async () => {
        const change = await api.add(form);
        applied(change);
        setNotice({ kind: 'saved', quarantined: change.quarantined });
      }),
    remove: (id) =>
      run(async () => {
        const change = await api.remove(id);
        applied(change);
        if (editing?.mode === 'edit' && editing.id === id) setEditing(null);
        setNotice({ kind: 'removed', change });
      }),
    move: (id, by) =>
      run(async () => {
        const index = view?.items.findIndex((item) => item.id === id) ?? -1;
        if (index === -1) return;
        applied(await api.move(id, Math.max(0, index + by)));
      }),
    setDefault: (id) =>
      run(async () => {
        const { defaultId } = await api.setDefault(id);
        setView((current) => (current === null ? current : { ...current, defaultId }));
      }),
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
