import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TurnUsage } from '@/contract/snapshot';
import { t } from '@/domain/i18n';
import { renderMarkdown } from '@/features/markdown/render';
import { openSettingsPage } from '@/platform/runtime/settings-page';
import { copyText } from './clipboard';
import type { Conversation } from './conversation';
import {
  canAsk,
  isAnswered,
  isBusy,
  modelName,
  type CutNote,
  type PanelProblem,
  type PanelState,
  type SnapshotNote,
  type Turn,
} from './state';
import { usePanel } from './use-panel';

export function PanelApp() {
  const { state, stop, summarize, ask, retry, switchModel } = usePanel();
  const busy = isBusy(state);
  const attached = state.phase !== 'attaching' && state.problem?.kind !== 'attach';

  useFollowConversation(state);

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
        ) : attached ? (
          <button type="button" title={t('panel.retry.title')} onClick={summarize}>
            {t('panel.retry')}
          </button>
        ) : null}
      </div>

      {state.snapshot !== null ? (
        <p className="note" data-snapshot={state.snapshot.kind}>
          {describeSnapshot(state.snapshot)}
        </p>
      ) : null}

      <div className="conversation">
        {state.turns.map((turn, index) => (
          <TurnView key={index} turn={turn} streaming={busy && index === state.turns.length - 1} />
        ))}

        {state.problem !== null ? (
          <Problem problem={state.problem} origin={state.origin} retry={retry} />
        ) : null}
      </div>

      {attached ? <AskForm enabled={canAsk(state)} ask={ask} /> : null}
    </main>
  );
}

/**
 * Keeps the latest follow-up in view: a question just asked or a restored
 * conversation scrolls to the end, and an answer coming in stays in view
 * unless the user scrolled away from the end. A summary alone is left where
 * the user reads it, from its start.
 */
function useFollowConversation(state: PanelState): void {
  const following = useRef(true);
  useEffect(() => {
    const update = () => {
      const page = document.documentElement;
      following.current = page.scrollHeight - page.scrollTop - page.clientHeight < 32;
    };
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);

  // What can lengthen the end of the conversation: a new turn, more text,
  // the usage line once it is done, a problem.
  const count = state.turns.length;
  const last = state.turns.at(-1);
  const added = useRef(0);
  useLayoutEffect(() => {
    const grew = count > added.current;
    added.current = count;
    if (count > 1 && (grew || following.current)) {
      window.scrollTo(0, document.documentElement.scrollHeight);
    }
  }, [count, last?.text, last?.status, state.problem]);
}

interface TurnProps {
  turn: Turn;
  streaming: boolean;
}

/** One question and its answer. A finished turn never changes, so it never renders again. */
const TurnView = memo(function TurnView({ turn, streaming }: TurnProps) {
  const html = useMemo(() => renderMarkdown(turn.text), [turn.text]);

  return (
    <section className="turn">
      {turn.question !== null ? <p className="question">{turn.question}</p> : null}
      {turn.cut !== null ? <p className="note">{describeCut(turn.cut)}</p> : null}
      {turn.text !== '' ? (
        // Built by renderMarkdown, which escapes raw HTML and drops unsafe
        // links and every image (docs/development-plan.md §8).
        <article
          className="answer"
          aria-busy={streaming}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : null}
      {isAnswered(turn) ? (
        <div className="meta">
          {turn.status === 'stopped' ? <span>{t('panel.stoppedMark')}</span> : null}
          {turn.usage !== null ? <UsageLine usage={turn.usage} /> : null}
          <CopyButton text={turn.text} />
        </div>
      ) : null}
    </section>
  );
});

/**
 * What the answer used: the service's figures, or, when it reported none, an
 * estimate marked with ≈. Never a mix (docs/development-plan.md §4.4, decision 5).
 */
function UsageLine({ usage }: { usage: TurnUsage }) {
  if (usage.source === 'estimate') {
    return (
      <span className="usage" data-usage="estimate" title={t('panel.usage.estimateTitle')}>
        {t('panel.usage.estimate', { parts: usageParts(usage.input, usage.output, null) })}
      </span>
    );
  }
  const parts = usageParts(usage.input, usage.output, usage.total);
  return parts === '' ? null : (
    <span className="usage" data-usage="service">
      {t('panel.usage.service', { parts })}
    </span>
  );
}

function usageParts(input: number | null, output: number | null, total: number | null): string {
  const parts: string[] = [];
  if (input !== null) parts.push(t('panel.usage.input', { count: formatCount(input) }));
  if (output !== null) parts.push(t('panel.usage.output', { count: formatCount(output) }));
  if (parts.length === 0 && total !== null) {
    parts.push(t('panel.usage.total', { count: formatCount(total) }));
  }
  return parts.join(' · ');
}

function CopyButton({ text }: { text: string }) {
  const [result, setResult] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (result === 'idle') return;
    const timer = setTimeout(() => setResult('idle'), 1_500);
    return () => clearTimeout(timer);
  }, [result]);

  return (
    <button
      type="button"
      className="quiet"
      title={t('panel.copy.title')}
      onClick={() => {
        copyText(text).then(
          () => setResult('copied'),
          () => setResult('failed'),
        );
      }}
    >
      {result === 'copied'
        ? t('panel.copied')
        : result === 'failed'
          ? t('panel.copyFailed')
          : t('panel.copy')}
    </button>
  );
}

function AskForm({ enabled, ask }: { enabled: boolean; ask: Conversation['ask'] }) {
  const [question, setQuestion] = useState('');
  const ready = enabled && question.trim() !== '';
  const send = () => {
    if (!ready) return;
    ask(question);
    setQuestion('');
  };

  return (
    <form
      className="ask"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <textarea
        aria-label={t('panel.ask')}
        placeholder={t('panel.ask.placeholder')}
        rows={2}
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        onKeyDown={(event) => {
          // Enter while an input method is composing picks a candidate.
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          send();
        }}
      />
      <button type="submit" disabled={!ready}>
        {t('panel.send')}
      </button>
    </form>
  );
}

function describePhase(state: PanelState): string {
  const model = modelName(state);
  switch (state.phase) {
    case 'attaching':
      return t('panel.status.attaching');
    case 'restored':
      return t('panel.status.restored');
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

function describeCut(cut: CutNote): string {
  if (cut.kind === 'extraction') return t('panel.truncated');
  const kept = t('panel.cut.budget', {
    total: formatCount(cut.totalTokens),
    strategy: t(`panel.strategy.${cut.strategy}`),
    kept: formatCount(cut.keptTokens),
  });
  return cut.assumedWindow
    ? `${kept}${t('panel.cut.assumed', { window: formatCount(cut.contextWindow) })}`
    : kept;
}

function describeSnapshot(note: SnapshotNote): string {
  switch (note.kind) {
    case 'restored-truncated':
      return t('panel.snapshot.restoredTruncated');
    case 'evicted':
      return t('panel.snapshot.evicted');
    case 'restore-failed':
      return t('panel.snapshot.restoreFailed', { detail: note.detail });
    case 'save-truncated':
      return t('panel.snapshot.saveTruncated');
    case 'save-failed':
      return t('panel.snapshot.saveFailed', { detail: note.detail });
  }
}

interface ProblemProps {
  problem: PanelProblem;
  origin: string | null;
  retry: Conversation['retry'];
}

function Problem({ problem, origin, retry }: ProblemProps) {
  const lines: string[] = [];
  let settings = false;
  let again: 'retry' | 'cut' | null = null;

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
      again = 'retry';
      break;
    case 'switch':
      lines.push(t('panel.switchFailed', { detail: problem.detail }));
      again = 'retry';
      break;
    case 'extract':
      lines.push(t('panel.extractFailed', { detail: problem.detail }));
      again = 'retry';
      break;
    case 'empty-page':
      lines.push(t('panel.emptyPage'));
      break;
    case 'too-long':
      lines.push(
        t('panel.tooLong', {
          required: formatCount(problem.requiredTokens),
          window: formatCount(problem.contextWindow),
        }),
      );
      break;
    case 'empty-answer':
      lines.push(t('panel.emptyAnswer'));
      again = 'retry';
      break;
    case 'llm': {
      const { error, window } = problem;
      lines.push(t(`error.${error.kind}`, { status: error.status ?? '', origin: origin ?? '' }));
      if (error.detail !== '') lines.push(t('error.detail', { detail: error.detail }));
      if (error.kind === 'auth' || error.kind === 'unauthorized-access') {
        settings = true;
      } else if (error.kind === 'context-length') {
        if (window === null) {
          lines.push(t('panel.contextHint.unchecked'));
          again = 'cut';
        } else {
          const params = { window: formatCount(window.contextWindow) };
          lines.push(
            window.assumedWindow
              ? t('panel.contextHint.assumed', params)
              : t('panel.contextHint.configured', params),
          );
          settings = true;
        }
      } else if (error.kind !== 'aborted') {
        again = 'retry';
      }
      break;
    }
  }

  return (
    <div className="problem" role="alert">
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
      {again !== null || settings ? (
        <div className="actions">
          {again === 'retry' ? (
            <button type="button" onClick={() => retry()}>
              {t('panel.retryTurn')}
            </button>
          ) : null}
          {again === 'cut' ? (
            <button type="button" onClick={() => retry({ cut: true })}>
              {t('panel.cutRetry')}
            </button>
          ) : null}
          {settings ? (
            <button type="button" onClick={() => void openSettingsPage()}>
              {t('panel.openSettings')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function formatCount(count: number): string {
  return count.toLocaleString('en-US');
}
