import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GENERAL_SETTINGS_KEY, type GeneralSettingsPatch } from '@/contract/general-settings';
import type { GeneralSettingsView } from '@/contract/rpc';
import { callRpc } from '@/platform/rpc/client';
import { onStoredChange } from '@/platform/storage/watch';

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
  // Changes made in quick succession are all shown until the newest is
  // answered: an earlier answer must not take away a later change's value.
  const newest = useRef(0);

  // Read again when another tab changes them (#30); only the newest read shows.
  useEffect(() => {
    let active = true;
    let reads = 0;
    const read = () => {
      const current = ++reads;
      const latest = () => active && current === reads;
      callRpc('settings.get', {}).then(
        (loaded) => latest() && setView(loaded),
        (error: unknown) => latest() && setLoadError(messageOf(error)),
      );
    };
    read();
    const stop = onStoredChange([GENERAL_SETTINGS_KEY], read);
    return () => {
      active = false;
      stop();
    };
  }, []);

  const update = useCallback(async (patch: GeneralSettingsPatch) => {
    const ticket = ++newest.current;
    setSave({ kind: 'saving' });
    setPending((shown) => ({ ...shown, ...patch }));
    try {
      const saved = await callRpc('settings.patch', patch);
      setView(saved);
      setSave({ kind: 'saved', quarantined: saved.quarantined });
    } catch (error) {
      setSave({ kind: 'failed', message: messageOf(error) });
    } finally {
      if (ticket === newest.current) setPending(null);
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
