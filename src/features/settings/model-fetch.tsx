import { useEffect, useRef, useState } from 'react';
import { t } from '@/domain/i18n';
import type { LlmError } from '@/domain/llm/errors';
import { modelOptions, type ParsedConnection } from '@/domain/model-form';
import { listModels } from '@/platform/llm/client';
import { requestOriginAccess } from '@/platform/permissions/origin-access';
import { describeFailure } from './connection-test';

type FetchState =
  | { kind: 'idle' }
  | { kind: 'fetching' }
  | { kind: 'listed'; models: string[] }
  | { kind: 'unsupported' }
  | { kind: 'failed'; error: LlmError; origin: string };

interface ModelFetchProps {
  /** The fields that reach the service, checked as they are now; null (errors shown) when they do not parse. */
  check: () => ParsedConnection | null;
  /** The model name in the form, selected in the list when it is there. */
  model: string;
  onPick: (model: string) => void;
  /** Adds a listed model to the ones the panel's menu offers. */
  onAddToMenu: (model: string) => void;
}

/**
 * Fetches the service's model list (`GET {baseURL}/models`) so the model
 * name can be picked rather than typed. Costs no tokens, and asks for host
 * access first, inside the click, as the connection test does.
 */
export function ModelFetch({ check, model, onPick, onAddToMenu }: ModelFetchProps) {
  const [state, setState] = useState<FetchState>({ kind: 'idle' });
  const run = useRef<AbortController | null>(null);

  useEffect(() => () => run.current?.abort(), []);

  const fetchList = () => {
    const config = check();
    if (config === null) return;
    // Still inside the click: the browser shows the prompt only during a gesture.
    const access = requestOriginAccess(config.baseURL);
    run.current?.abort();
    const controller = new AbortController();
    run.current = controller;
    setState({ kind: 'fetching' });
    void (async () => {
      await access.catch(() => false);
      const outcome = await listModels({ config, signal: controller.signal });
      if (controller.signal.aborted) return;
      switch (outcome.kind) {
        case 'listed':
          setState({ kind: 'listed', models: modelOptions(outcome.models) });
          return;
        case 'unsupported':
          setState({ kind: 'unsupported' });
          return;
        case 'error':
          setState({
            kind: 'failed',
            error: outcome.error,
            origin: new URL(config.baseURL).origin,
          });
      }
    })();
  };

  const listed = state.kind === 'listed' && state.models.length > 0 ? state.models : null;

  return (
    <div className="model-fetch">
      <button
        type="button"
        className="secondary"
        disabled={state.kind === 'fetching'}
        onClick={fetchList}
      >
        {state.kind === 'fetching' ? t('model.fetch.fetching') : t('model.fetch')}
      </button>
      {listed !== null ? (
        <select
          aria-label={t('model.fetch.pick')}
          value={listed.includes(model) ? model : ''}
          onChange={(event) => {
            if (event.target.value !== '') onPick(event.target.value);
          }}
        >
          <option value="" disabled>
            {t('model.fetch.choose', { count: listed.length })}
          </option>
          {listed.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : null}
      {listed !== null ? (
        <select
          aria-label={t('model.fetch.addMenu')}
          value=""
          onChange={(event) => {
            if (event.target.value !== '') onAddToMenu(event.target.value);
          }}
        >
          <option value="" disabled>
            {t('model.fetch.addMenuChoose')}
          </option>
          {listed.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : null}
      <p aria-live="polite" className="fetch-result hint" data-result={state.kind}>
        {describe(state)}
      </p>
    </div>
  );
}

function describe(state: FetchState): string {
  switch (state.kind) {
    case 'idle':
    case 'fetching':
      return '';
    case 'listed':
      return state.models.length === 0 ? t('model.fetch.empty') : '';
    case 'unsupported':
      return t('model.fetch.unsupported');
    case 'failed':
      return `${t('model.fetch.failed')}${describeFailure(state.error, state.origin)}`;
  }
}
