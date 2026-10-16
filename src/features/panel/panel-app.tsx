import {
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import type { Locale } from '@/contract/rpc-wire';
import type { TurnUsage } from '@/contract/snapshot';
import { plainCitations } from '@/domain/citation';
import { t } from '@/domain/i18n';
import { adviceFor, isLocalOriginRefusal, type LlmError } from '@/domain/llm/errors';
import { renderMarkdown } from '@/features/markdown/render';
import { CheckIcon, CopyIcon, RefreshIcon, StopIcon } from '@/features/ui/icons';
import { MoreMenu } from '@/features/ui/more-menu';
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
  const {
    state,
    locale,
    stop,
    summarize,
    ask,
    retry,
    switchModel,
    switchPrompt,
    pageText,
    locate,
  } = usePanel();
  const busy = isBusy(state);
  const attached = state.phase !== 'attaching' && state.problem?.kind !== 'attach';
  const conversation = useRef<HTMLDivElement>(null);
  const located = useQuoteLocator(conversation, locate);
  const preview = useQuotePreview(conversation);

  useFollowConversation(state);

  return (
    <main className="panel" data-phase={state.phase} data-problem={state.problem?.kind}>
      <div className="toolbar">
        {state.models.length > 0 ? (
          <select
            className="menu model"
            aria-label={t('panel.model')}
            title={modelName(state)}
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
        {state.prompts.length > 1 ? (
          <select
            className="menu prompt"
            aria-label={t('panel.prompt')}
            title={t('panel.prompt.title')}
            value={state.promptId ?? ''}
            onChange={(event) => switchPrompt(event.target.value)}
          >
            {state.prompts.map((prompt) => (
              <option key={prompt.id} value={prompt.id}>
                {prompt.name}
              </option>
            ))}
          </select>
        ) : null}
        {/* Said aloud always; shown only while something is going on or went wrong. */}
        <p className="status" role="status" data-quiet={quietPhase(state)}>
          {busy ? <span className="pulse" aria-hidden="true" /> : null}
          {describePhase(state)}
        </p>
        {busy ? (
          <button
            type="button"
            className="icon-button outlined"
            aria-label={t('panel.stop')}
            title={t('panel.stop')}
            onClick={stop}
          >
            <StopIcon />
          </button>
        ) : attached && state.phase !== 'ready' ? (
          <button
            type="button"
            className="icon-button outlined"
            aria-label={t('panel.retry')}
            title={t('panel.retry.title')}
            onClick={summarize}
          >
            <RefreshIcon />
          </button>
        ) : null}
        {attached ? (
          <MoreMenu label={t('panel.more')}>
            {(close) => (
              <>
                <CopyButton
                  text={pageText}
                  label={t('panel.copyPage')}
                  title={t('panel.copyPage.title')}
                />
                <button
                  type="button"
                  className="quiet"
                  onClick={() => {
                    close();
                    void openSettingsPage();
                  }}
                >
                  {t('panel.openSettings')}
                </button>
              </>
            )}
          </MoreMenu>
        ) : null}
      </div>

      {state.mode === 'selection' ? (
        <p className="note" data-mode="selection">
          {t('panel.selectionMode')}
        </p>
      ) : null}

      {state.snapshot !== null ? (
        <p className="note" data-snapshot={state.snapshot.kind}>
          {describeSnapshot(state.snapshot)}
        </p>
      ) : null}

      {located !== null ? (
        <p className="note" aria-live="polite" data-located={located.found ? 'found' : 'missing'}>
          {located.message}
        </p>
      ) : null}

      <div className="conversation" ref={conversation}>
        {state.phase === 'ready' ? (
          <div className="start">
            <button type="button" onClick={summarize}>
              {t('panel.summarize')}
            </button>
          </div>
        ) : null}

        {state.turns.map((turn, index) => (
          // A new language renders the turn afresh: its quote markers carry labels.
          <TurnView
            key={`${index}-${locale}`}
            turn={turn}
            streaming={busy && index === state.turns.length - 1}
            locale={locale}
          />
        ))}

        {state.problem !== null ? (
          <Problem problem={state.problem} origin={state.origin} retry={retry} />
        ) : null}
      </div>

      {preview !== null ? (
        <div
          className="quote-preview"
          aria-hidden="true"
          data-above={preview.above}
          style={{ top: preview.top, left: preview.left }}
        >
          <p>{preview.quote}</p>
          <small>{t('panel.cite.hint')}</small>
        </div>
      ) : null}

      {attached ? <AskForm enabled={canAsk(state)} ask={ask} /> : null}
    </main>
  );
}

interface Located {
  found: boolean;
  message: string;
}

/**
 * Quote markers in answers (features/markdown) find their passage in the
 * page when pressed, by click or keyboard: one listener on the conversation
 * catches them all. What came of it shows for a few seconds; nothing when
 * the quote was found, since the page shows it.
 */
function useQuoteLocator(
  container: RefObject<HTMLElement | null>,
  locate: (quote: string) => Promise<boolean>,
): Located | null {
  const [located, setLocated] = useState<Located | null>(null);

  useEffect(() => {
    const element = container.current;
    if (element === null) return;
    let latest = 0;
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest('button.cite') : null;
      const quote = target instanceof HTMLElement ? target.dataset.quote : undefined;
      if (quote === undefined) return;
      const asked = ++latest;
      locate(quote).then(
        (found) => {
          if (asked !== latest) return;
          setLocated(found ? null : { found, message: t('panel.cite.notFound', { quote }) });
        },
        (error: unknown) => {
          if (asked !== latest) return;
          const detail = error instanceof Error ? error.message : String(error);
          setLocated({ found: false, message: t('panel.cite.failed', { detail }) });
        },
      );
    };
    element.addEventListener('click', onClick);
    return () => element.removeEventListener('click', onClick);
  }, [container, locate]);

  useEffect(() => {
    if (located === null) return;
    const timer = setTimeout(() => setLocated(null), 5_000);
    return () => clearTimeout(timer);
  }, [located]);

  return located;
}

interface QuotePreview {
  quote: string;
  /** Its top edge, or its bottom edge when it is `above` the marker. */
  top: number;
  left: number;
  above: boolean;
}

/** Room the preview needs below a marker before it goes above instead. */
const PREVIEW_ROOM = 140;
const PREVIEW_WIDTH = 280;

/**
 * Shows the passage a quote marker stands for while the pointer is on it or
 * it has focus, below it (or above, near the bottom), kept inside the panel.
 * Screen readers get the marker's own label; the preview is for the eye.
 */
function useQuotePreview(container: RefObject<HTMLElement | null>): QuotePreview | null {
  const [preview, setPreview] = useState<QuotePreview | null>(null);

  useEffect(() => {
    const element = container.current;
    if (element === null) return;
    const show = (event: Event) => {
      const target = event.target instanceof Element ? event.target.closest('button.cite') : null;
      if (!(target instanceof HTMLElement) || target.dataset.quote === undefined) return;
      const rect = target.getBoundingClientRect();
      const width = Math.min(PREVIEW_WIDTH, window.innerWidth - 16);
      const left = Math.min(Math.max(8, rect.left - 24), window.innerWidth - width - 8);
      const below = rect.bottom + PREVIEW_ROOM < window.innerHeight;
      setPreview({
        quote: target.dataset.quote,
        top: below ? rect.bottom + 6 : rect.top - 6,
        left,
        above: !below,
      });
    };
    const hide = (event: Event) => {
      const target = event.target instanceof Element ? event.target.closest('button.cite') : null;
      if (target !== null) setPreview(null);
    };
    const away = () => setPreview(null);
    element.addEventListener('mouseover', show);
    element.addEventListener('focusin', show);
    element.addEventListener('mouseout', hide);
    element.addEventListener('focusout', hide);
    window.addEventListener('scroll', away, { passive: true });
    return () => {
      element.removeEventListener('mouseover', show);
      element.removeEventListener('focusin', show);
      element.removeEventListener('mouseout', hide);
      element.removeEventListener('focusout', hide);
      window.removeEventListener('scroll', away);
    };
  }, [container]);

  return preview;
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
  /** Its words (labels, quote markers) are in the interface language. */
  locale: Locale;
}

/** One question and its answer. A finished turn never changes, so it never renders again. */
const TurnView = memo(function TurnView({ turn, streaming, locale }: TurnProps) {
  const html = useMemo(() => renderMarkdown(turn.text), [turn.text]);

  return (
    <section className="turn">
      {turn.question !== null ? <p className="question">{turn.question}</p> : null}
      {turn.cut !== null ? <p className="note">{describeCut(turn.cut)}</p> : null}
      {turn.reasoning !== '' ? (
        // Folded: the answer is what the panel is for (§4.5, decision 3).
        <details className="reasoning">
          <summary>{t('panel.reasoning')}</summary>
          <p>{turn.reasoning}</p>
        </details>
      ) : null}
      {streaming && turn.text === '' && turn.reasoning === '' ? (
        // Nothing has arrived yet: lines where the answer will be.
        <div className="placeholder" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      ) : null}
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
          <CopyButton
            icon
            text={() => plainCitations(turn.text, locale)}
            label={t('panel.copy')}
            title={t('panel.copy.title')}
          />
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

interface CopyButtonProps {
  /** What to copy, worked out when the button is pressed. */
  text: () => string | Promise<string>;
  label: string;
  title: string;
  /** An icon, its words in its name, rather than words. */
  icon?: boolean;
}

function CopyButton({ text, label, title, icon = false }: CopyButtonProps) {
  const [result, setResult] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (result === 'idle') return;
    const timer = setTimeout(() => setResult('idle'), 1_500);
    return () => clearTimeout(timer);
  }, [result]);

  const words =
    result === 'copied' ? t('panel.copied') : result === 'failed' ? t('panel.copyFailed') : label;
  const copy = () => {
    Promise.resolve()
      .then(text)
      .then(copyText)
      .then(
        () => setResult('copied'),
        () => setResult('failed'),
      );
  };

  return icon ? (
    <button
      type="button"
      className="icon-button"
      aria-label={words}
      title={result === 'idle' ? title : words}
      data-result={result}
      onClick={copy}
    >
      {result === 'copied' ? <CheckIcon /> : <CopyIcon />}
    </button>
  ) : (
    <button type="button" className="quiet" title={title} onClick={copy}>
      {words}
    </button>
  );
}

function AskForm({ enabled, ask }: { enabled: boolean; ask: Conversation['ask'] }) {
  const [question, setQuestion] = useState('');
  const ready = enabled && question.trim() !== '';
  const hintId = useId();
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
        aria-describedby={hintId}
        placeholder={t('panel.ask.placeholder')}
        rows={1}
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
      <p className="ask-hint" id={hintId}>
        {t('panel.ask.hint')}
      </p>
    </form>
  );
}

/** A finished summary needs no words above it: the answer says it is done. */
function quietPhase(state: PanelState): boolean {
  return state.phase === 'done';
}

function describePhase(state: PanelState): string {
  const model = modelName(state);
  switch (state.phase) {
    case 'attaching':
      return t('panel.status.attaching');
    case 'ready':
      return t('panel.status.ready');
    case 'restored':
      return t('panel.status.restored');
    case 'extracting':
      return t('panel.status.extracting');
    case 'requesting':
      return state.retrying === null
        ? t('panel.status.requesting', { model })
        : t('panel.status.retrying', { seconds: state.retrying });
    case 'streaming':
      // Reasoning first, the answer after.
      return state.turns.at(-1)?.text === ''
        ? t('panel.status.thinking', { model })
        : t('panel.status.streaming', { model });
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
    case 'empty-selection':
      lines.push(t('panel.emptySelection'));
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
      lines.push(t(`error.${error.kind}`, { origin: origin ?? '' }));
      const detail = errorDetail(error);
      if (detail !== null) lines.push(detail);
      if (origin !== null && isLocalOriginRefusal(error, origin)) {
        lines.push(t('error.hint.localOrigin'));
      }
      if (error.kind === 'rate-limit' && error.retryAfter !== undefined) {
        lines.push(t('error.hint.retryAfter', { seconds: error.retryAfter }));
      }
      if (error.kind === 'context-length') {
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
      } else {
        const advice = adviceFor(error.kind);
        if (advice.retry) again = 'retry';
        settings = advice.settings;
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

/**
 * What the service or the browser said: the status and the service's words,
 * or the browser's report for a request that never got an answer.
 */
function errorDetail(error: LlmError): string | null {
  const { status, detail } = error;
  if (status !== undefined) {
    return detail === ''
      ? t('error.status', { status })
      : t('error.statusDetail', { status, detail });
  }
  if (detail === '') return null;
  return error.kind === 'network' || error.kind === 'unauthorized-access'
    ? t('error.browserDetail', { detail })
    : t('error.detail', { detail });
}

function formatCount(count: number): string {
  return count.toLocaleString('en-US');
}
