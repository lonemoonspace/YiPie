import { useCallback, useEffect, useState } from 'react';
import type { ListView } from '@/contract/rpc';
import { t } from '@/domain/i18n';

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
 */
export function useConfigList<T>(load: () => Promise<ListView<T>>): ConfigList<T> {
  const [view, setView] = useState<ListView<T> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<ChangeStatus>({ kind: 'idle' });

  useEffect(() => {
    let active = true;
    load().then(
      (loaded) => active && setView(loaded),
      (error: unknown) => active && setLoadError(messageOf(error)),
    );
    return () => {
      active = false;
    };
  }, [load]);

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
