import { useMemo } from 'react';
import { t } from '@/domain/i18n';
import { renderMarkdown } from '@/features/markdown/render';
import { openSettingsPage } from '@/platform/runtime/settings-page';
import { isBusy, modelName, type PanelProblem, type PanelState } from './state';
import { usePanel } from './use-panel';

export function PanelApp() {
  const { state, stop, retry, switchModel } = usePanel();
  const busy = isBusy(state);
  const html = useMemo(() => renderMarkdown(state.text), [state.text]);
  const canRetry = !busy && state.phase !== 'attaching' && state.problem?.kind !== 'attach';

  return (
    <main className="panel" data-phase={state.phase} data-problem={state.problem?.kind}>
      <div className="toolbar">
        {state.models.length > 0 ? (
          <select
            className="model"
            aria-label={t('panel.model')}
            value={state.modelId ?? ''}
            onChange={(event) => switchModel(event.target.value)}
          >
            {state.models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
        ) : null}
        <p className="status" role="status">
          {describePhase(state)}
        </p>
        {busy ? (
          <button type="button" onClick={stop}>
            {t('panel.stop')}
          </button>
        ) : canRetry ? (
          <button type="button" onClick={retry}>
            {t('panel.retry')}
          </button>
        ) : null}
      </div>

      {state.truncated ? <p className="note">{t('panel.truncated')}</p> : null}

      {state.text !== '' ? (
        // Built by renderMarkdown, which escapes raw HTML and drops unsafe
        // links and every image (docs/development-plan.md §8).
        <article className="answer" aria-busy={busy} dangerouslySetInnerHTML={{ __html: html }} />
      ) : null}

      {state.problem !== null ? <Problem problem={state.problem} origin={state.origin} /> : null}
    </main>
  );
}

function describePhase(state: PanelState): string {
  const model = modelName(state);
  switch (state.phase) {
    case 'attaching':
      return t('panel.status.attaching');
    case 'extracting':
      return t('panel.status.extracting');
    case 'requesting':
      return t('panel.status.requesting', { model });
    case 'streaming':
      return t('panel.status.streaming', { model });
    case 'done':
      return t('panel.status.done');
    case 'stopped':
      return t('panel.status.stopped');
    case 'error':
      return t('panel.status.error');
  }
}

function Problem({ problem, origin }: { problem: PanelProblem; origin: string | null }) {
  const lines: string[] = [];
  let settings = false;

  switch (problem.kind) {
    case 'attach':
      lines.push(t('panel.attachFailed'));
      break;
    case 'no-model':
      lines.push(t('panel.noModel'));
      settings = true;
      break;
    case 'no-prompt':
      lines.push(t('panel.noPrompt'));
      settings = true;
      break;
    case 'config':
      lines.push(t('panel.configFailed', { detail: problem.detail }));
      break;
    case 'switch':
      lines.push(t('panel.switchFailed', { detail: problem.detail }));
      break;
    case 'extract':
      lines.push(t('panel.extractFailed', { detail: problem.detail }));
      break;
    case 'empty-page':
      lines.push(t('panel.emptyPage'));
      break;
    case 'llm': {
      const { error } = problem;
      lines.push(t(`error.${error.kind}`, { status: error.status ?? '', origin: origin ?? '' }));
      if (error.detail !== '') lines.push(t('error.detail', { detail: error.detail }));
      settings = error.kind === 'auth' || error.kind === 'unauthorized-access';
      break;
    }
  }

  return (
    <div className="problem" role="alert">
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
      {settings ? (
        <button type="button" onClick={() => void openSettingsPage()}>
          {t('panel.openSettings')}
        </button>
      ) : null}
    </div>
  );
}
