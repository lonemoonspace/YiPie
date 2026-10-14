import { useCallback, useEffect, useReducer, useRef } from 'react';
import { displayName, type ModelConfig } from '@/contract/model-config';
import type { PageContext } from '@/contract/page-context';
import { buildSummaryMessages } from '@/domain/prompt/default-prompt';
import { streamChat } from '@/platform/llm/client';
import { callRpc } from '@/platform/rpc/client';
import { INITIAL_PANEL_STATE, reducePanel, type PanelState } from './state';

export interface PanelControls {
  state: PanelState;
  stop: () => void;
  retry: () => void;
}

/**
 * The panel's whole run: attach with the nonce in our URL, then summarize
 * right away (docs/development-plan.md §4.2, decision 3). Retrying starts a
 * new run and aborts the old one, so at most one request is ever in flight.
 */
export function usePanel(): PanelControls {
  const [state, dispatch] = useReducer(reducePanel, INITIAL_PANEL_STATE);
  const run = useRef<AbortController | null>(null);

  const summarize = useCallback(async () => {
    run.current?.abort();
    const controller = new AbortController();
    run.current = controller;
    const current = () => run.current === controller;
    dispatch({ type: 'start' });

    let config: ModelConfig | undefined;
    try {
      config = (await callRpc('models.list', {})).configs[0];
    } catch (error) {
      if (current())
        dispatch({ type: 'failed', problem: { kind: 'models', detail: messageOf(error) } });
      return;
    }
    if (!current()) return;
    if (config === undefined) {
      dispatch({ type: 'failed', problem: { kind: 'no-model' } });
      return;
    }

    let page: PageContext;
    try {
      page = await callRpc('page.getContext', {});
    } catch (error) {
      if (current())
        dispatch({ type: 'failed', problem: { kind: 'extract', detail: messageOf(error) } });
      return;
    }
    if (!current()) return;
    if (page.text.trim() === '') {
      dispatch({ type: 'failed', problem: { kind: 'empty-page' } });
      return;
    }

    dispatch({
      type: 'requesting',
      model: displayName(config),
      origin: new URL(config.baseURL).origin,
      truncated: page.truncated,
    });

    // One render per frame, however fast the tokens come.
    let pending = '';
    let frame: number | null = null;
    const flush = () => {
      frame = null;
      if (pending !== '' && current()) dispatch({ type: 'text', text: pending });
      pending = '';
    };
    const outcome = await streamChat({
      config,
      messages: buildSummaryMessages(page),
      signal: controller.signal,
      onText: (text) => {
        pending += text;
        frame ??= requestAnimationFrame(flush);
      },
    });
    if (frame !== null) cancelAnimationFrame(frame);
    flush();
    if (!current()) return;

    if (outcome.kind === 'done') dispatch({ type: 'finished', usage: outcome.usage });
    else if (outcome.kind === 'stopped') dispatch({ type: 'stopped' });
    else dispatch({ type: 'failed', problem: { kind: 'llm', error: outcome.error } });
  }, []);

  useEffect(() => {
    let active = true;
    const nonce = window.location.hash.slice(1);
    callRpc('panel.attach', { nonce }).then(
      () => {
        if (active) void summarize();
      },
      () => {
        if (active) dispatch({ type: 'failed', problem: { kind: 'attach' } });
      },
    );
    return () => {
      active = false;
      run.current?.abort();
    };
  }, [summarize]);

  const stop = useCallback(() => run.current?.abort(), []);
  const retry = useCallback(() => void summarize(), [summarize]);

  return { state, stop, retry };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
