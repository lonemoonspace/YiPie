import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GeneralSettingsPatch } from '@/contract/general-settings';
import type { GeneralSettingsView } from '@/contract/rpc';
import { callRpc } from '@/platform/rpc/client';

export type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; quarantined: boolean }
  | { kind: 'failed'; message: string };

export interface GeneralSettingsState {
  view: GeneralSettingsView | null;
  loadError: string | null;
  save: SaveState;
  update: (patch: GeneralSettingsPatch) => Promise<void>;
}

/**
 * Reads general settings through the background and writes them back one
 * field at a time. Writes never happen here directly: they are RPCs, so the
 * background's single queue orders them.
 */
export function useGeneralSettings(): GeneralSettingsState {
  const [view, setView] = useState<GeneralSettingsView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  // The change being saved shows at once: a controlled checkbox would
  // otherwise spring back until the background answers.
  const [pending, setPending] = useState<GeneralSettingsPatch | null>(null);

  useEffect(() => {
    let active = true;
    callRpc('settings.get', {}).then(
      (loaded) => active && setView(loaded),
      (error: unknown) => active && setLoadError(messageOf(error)),
    );
    return () => {
      active = false;
    };
  }, []);

  const update = useCallback(async (patch: GeneralSettingsPatch) => {
    setSave({ kind: 'saving' });
    setPending(patch);
    try {
      const saved = await callRpc('settings.patch', patch);
      setView(saved);
      setSave({ kind: 'saved', quarantined: saved.quarantined });
    } catch (error) {
      setSave({ kind: 'failed', message: messageOf(error) });
    } finally {
      setPending(null);
    }
  }, []);

  const shown = useMemo(
    () =>
      view === null || pending === null
        ? view
        : { ...view, settings: { ...view.settings, ...pending } },
    [view, pending],
  );

  return { view: shown, loadError, save, update };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
