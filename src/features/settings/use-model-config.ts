import { useCallback, useEffect, useState } from 'react';
import type { ModelConfig } from '@/contract/model-config';
import type { ModelConfigsView } from '@/contract/rpc';
import type { ParsedModelForm } from '@/domain/model-form';
import { hasOriginAccess } from '@/platform/permissions/origin-access';
import { callRpc } from '@/platform/rpc/client';

export type ModelSaveState =
  { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'failed'; message: string };

/** Whether we hold the host permission for the saved base URL. */
export type OriginAccess = 'unknown' | 'granted' | 'missing';

export interface ModelConfigState {
  view: ModelConfigsView | null;
  loadError: string | null;
  /** The configuration being edited: phase 1 edits the first one, or creates it. */
  current: ModelConfig | null;
  save: ModelSaveState;
  /** Counts successful saves, so the form can start over from what was stored. */
  revision: number;
  access: OriginAccess;
  /**
   * Saves the form. `accessRequest` is the permission prompt, which the
   * caller has to start inside the submit event, before this awaits anything.
   */
  submit: (form: ParsedModelForm, accessRequest: Promise<boolean>) => Promise<void>;
}

export function useModelConfig(): ModelConfigState {
  const [view, setView] = useState<ModelConfigsView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [save, setSave] = useState<ModelSaveState>({ kind: 'idle' });
  const [revision, setRevision] = useState(0);
  const [access, setAccess] = useState<OriginAccess>('unknown');

  const current = view?.configs[0] ?? null;
  const baseURL = current?.baseURL;

  useEffect(() => {
    let active = true;
    callRpc('models.list', {}).then(
      (loaded) => active && setView(loaded),
      (error: unknown) => active && setLoadError(messageOf(error)),
    );
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (baseURL === undefined) return;
    let active = true;
    void hasOriginAccess(baseURL).then(
      (granted) => active && setAccess(granted ? 'granted' : 'missing'),
    );
    return () => {
      active = false;
    };
  }, [baseURL]);

  const submit = useCallback(
    async (form: ParsedModelForm, accessRequest: Promise<boolean>) => {
      setSave({ kind: 'saving' });
      try {
        const saved =
          current === null
            ? await callRpc('models.add', form)
            : await callRpc('models.update', { id: current.id, patch: form });
        setView(saved);
        setRevision((count) => count + 1);
        setSave({ kind: 'saved' });
      } catch (error) {
        setSave({ kind: 'failed', message: messageOf(error) });
        return;
      }
      setAccess((await accessRequest) ? 'granted' : 'missing');
    },
    [current],
  );

  return { view, loadError, current, save, revision, access, submit };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
