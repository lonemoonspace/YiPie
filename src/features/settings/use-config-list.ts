import { useCallback, useEffect, useState } from 'react';
import type { ListView } from '@/contract/rpc';
import { SELECTION_KEY } from '@/contract/selection';
import type { StorageKey } from '@/contract/storage';
import { t } from '@/domain/i18n';
import { onStoredChange } from '@/platform/storage/watch';

export type ChangeStatus =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'done'; message: string }
  | { kind: 'failed'; message: string };

export interface ConfigList<T> {
  view: ListView<T> | null;
  loadError: string | null;
  status: ChangeStatus;
  /**
   * Sends one change and shows what came of it, worded by `describe` from the
   * list the background sent back. Resolves to that list, or null when the
   * change failed (its message is shown instead).
   */
  change: (
    send: () => Promise<ListView<T>>,
    describe: (view: ListView<T>) => string,
  ) => Promise<ListView<T> | null>;
}

/**
 * One list of configurations, read through the background and changed one
 * step at a time. Nothing is written here: every change is an RPC, ordered by
 * the background's single write queue (docs/development-plan.md §4.3).
 * `load` must keep its identity across renders.
 *
 * The list is read again whenever `key` changes in storage: an import from
 * another section, or a change in another tab. So is it when the defaults
 * (`local:selection`) change, from another tab or the panel's menus: which
 * row is the default is part of the view, and the delete confirmation
 * announces where the default goes from it. Only the latest read is shown.
 */
export function useConfigList<T>(load: () => Promise<ListView<T>>, key: StorageKey): ConfigList<T> {
  const [view, setView] = useState<ListView<T> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<ChangeStatus>({ kind: 'idle' });

  useEffect(() => {
    let active = true;
    let reads = 0;
    const read = () => {
      const current = ++reads;
      const latest = () => active && current === reads;
      load().then(
        (loaded) => {
          if (!latest()) return;
          setView(loaded);
          setLoadError(null);
        },
        (error: unknown) => latest() && setLoadError(messageOf(error)),
      );
    };
    read();
    const stop = onStoredChange([key, SELECTION_KEY], read);
    return () => {
      active = false;
      stop();
    };
  }, [load, key]);

  const change = useCallback(
    async (send: () => Promise<ListView<T>>, describe: (next: ListView<T>) => string) => {
      setStatus({ kind: 'busy' });
      try {
        const next = await send();
        setView(next);
        const backedUp = next.quarantined ? t('list.quarantinedNote') : '';
        setStatus({ kind: 'done', message: `${describe(next)}${backedUp}` });
        return next;
      } catch (error) {
        setStatus({ kind: 'failed', message: t('list.failed', { detail: messageOf(error) }) });
        return null;
      }
    },
    [],
  );

  return { view, loadError, status, change };
}

export function describeStatus(status: ChangeStatus): string {
  switch (status.kind) {
    case 'idle':
      return '';
    case 'busy':
      return t('list.working');
    case 'done':
    case 'failed':
      return status.message;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
