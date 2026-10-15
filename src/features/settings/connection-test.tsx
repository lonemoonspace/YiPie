import { useEffect, useRef, useState } from 'react';
import { t } from '@/domain/i18n';
import type { LlmError } from '@/domain/llm/errors';
import type { ParsedModelForm } from '@/domain/model-form';
import { listModels, streamChat } from '@/platform/llm/client';
import { requestOriginAccess } from '@/platform/permissions/origin-access';

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'listed'; count: number; model: string; hasModel: boolean }
  /** No model list: a real request can test, at the cost of a few tokens. */
  | { kind: 'unsupported' }
  | { kind: 'answered' }
  | { kind: 'failed'; error: LlmError; origin: string };

interface ConnectionTestProps {
  /** The form checked as it is now; null (with the errors shown) when it does not parse. */
  check: () => ParsedModelForm | null;
}

/**
 * Tests the connection the form describes, saved or not
 * (docs/development-plan.md §4.6): first `GET {baseURL}/models`, which costs
 * nothing; when the service has no list, it offers one real request, which
 * costs a few tokens and stops at the first word of the answer. Asks for host
 * access first, inside the click, as saving does.
 */
export function ConnectionTest({ check }: ConnectionTestProps) {
  const [state, setState] = useState<TestState>({ kind: 'idle' });
  const run = useRef<AbortController | null>(null);
  const tested = useRef<ParsedModelForm | null>(null);

  useEffect(() => () => run.current?.abort(), []);

  const begin = () => {
    run.current?.abort();
    const controller = new AbortController();
    run.current = controller;
    setState({ kind: 'testing' });
    return controller;
  };

  const failed = (error: LlmError, config: ParsedModelForm): TestState => ({
    kind: 'failed',
    error,
    origin: new URL(config.baseURL).origin,
  });

  const testList = () => {
    const config = check();
    if (config === null) return;
    // Still inside the click: the browser shows the prompt only during a gesture.
    const access = requestOriginAccess(config.baseURL);
    tested.current = config;
    const controller = begin();
    void (async () => {
      await access.catch(() => false);
      const outcome = await listModels({ config, signal: controller.signal });
      if (controller.signal.aborted) return;
      switch (outcome.kind) {
        case 'listed':
          setState({
            kind: 'listed',
            count: outcome.models.length,
            model: config.model,
            hasModel: outcome.models.includes(config.model),
          });
          return;
        case 'unsupported':
          setState({ kind: 'unsupported' });
          return;
        case 'error':
          setState(failed(outcome.error, config));
      }
    })();
  };

  const testChat = () => {
    const config = tested.current;
    if (config === null) return;
    const controller = begin();
    const stop = new AbortController();
    let answered = false;
    void (async () => {
      const outcome = await streamChat({
        config,
        messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
        signal: stop.signal,
        // The first word is proof enough: stop there and spend no more.
        onText: () => {
          answered = true;
          stop.abort();
        },
      });
      if (controller.signal.aborted) return;
      if (answered || outcome.kind === 'done') setState({ kind: 'answered' });
      else if (outcome.kind === 'error') setState(failed(outcome.error, config));
      else setState({ kind: 'idle' });
    })();
    controller.signal.addEventListener('abort', () => stop.abort(), { once: true });
  };

  return (
    <div className="connection-test">
      <button
        type="button"
        className="secondary"
        disabled={state.kind === 'testing'}
        onClick={testList}
      >
        {state.kind === 'testing' ? t('model.test.testing') : t('model.test')}
      </button>
      <div aria-live="polite" className="test-result" data-result={state.kind}>
        {describe(state)}
        {state.kind === 'unsupported' ? (
          <button type="button" className="secondary" onClick={testChat}>
            {t('model.test.chat')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function describe(state: TestState): string {
  switch (state.kind) {
    case 'idle':
    case 'testing':
      return '';
    case 'listed':
      return `${t('model.test.listed', { count: state.count })}${
        state.hasModel
          ? t('model.test.hasModel', { model: state.model })
          : t('model.test.missingModel', { model: state.model })
      }`;
    case 'unsupported':
      return t('model.test.unsupported');
    case 'answered':
      return t('model.test.chatOk');
    case 'failed': {
      const { error, origin } = state;
      const detail =
        error.status !== undefined
          ? error.detail === ''
            ? t('error.status', { status: error.status })
            : t('error.statusDetail', { status: error.status, detail: error.detail })
          : error.detail === ''
            ? ''
            : t('error.browserDetail', { detail: error.detail });
      return `${t('model.test.failed')}${t(`error.${error.kind}`, { origin })}${detail === '' ? '' : ` ${detail}`}`;
    }
  }
}
