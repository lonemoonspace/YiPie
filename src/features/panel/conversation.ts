import type { TrimmingStrategy } from '@/contract/general-settings';
import type { PageContext } from '@/contract/page-context';
import type { PromptConfig } from '@/contract/prompt-config';
import type { ModelChoice, PanelModelConfig, SnapshotView } from '@/contract/rpc';
import type { SnapshotMessage } from '@/contract/snapshot';
import {
  DEFAULT_CONTEXT_WINDOW,
  estimateMessages,
  planContent,
  type ContentPlan,
  type CutStrategy,
} from '@/domain/budget';
import type { ChatMessage } from '@/domain/llm/request';
import { turnUsage } from '@/domain/llm/usage';
import {
  conversationMessages,
  pageContent,
  promptValues,
  type HistoryMessage,
} from '@/domain/prompt/messages';
import { countVariable } from '@/domain/prompt/render';
import { estimateTokens } from '@/domain/token-estimate';
import type { ChatOutcome } from '@/platform/llm/client';
import { createLatestOnly } from './latest-only';
import { createModelSwitcher } from './model-switcher';
import type { BudgetWindow, CutNote, Exchange, PanelEvent, PanelProblem } from './state';

/** What a run reads before it starts: always fresh, so the panel follows the settings. */
export interface RunSetup {
  /** The model menu, without credentials. */
  choices: ModelChoice[];
  /** The model in use, with its key; null when there is none. */
  config: PanelModelConfig | null;
  /** The default prompt; null when there is none. */
  prompt: Pick<PromptConfig, 'system' | 'user'> | null;
  trimming: TrimmingStrategy;
}

export interface StreamRequest {
  config: PanelModelConfig;
  messages: ChatMessage[];
  signal: AbortSignal;
  onText: (text: string) => void;
}

export interface ConversationDeps {
  setup: () => Promise<RunSetup>;
  /** The conversation saved for this page in this tab (`snapshot.get`). */
  restore: () => Promise<SnapshotView>;
  /** The page as it is now (`page.getContext`). */
  extract: () => Promise<PageContext>;
  /** Streams one answer; never throws (`streamChat`). */
  stream: (request: StreamRequest) => Promise<ChatOutcome>;
  /** Saves the whole conversation (`snapshot.save`). */
  save: (messages: SnapshotMessage[]) => Promise<{ truncated: boolean }>;
  /** Makes a model the default (`models.choose`). */
  choose: (id: string) => Promise<unknown>;
  dispatch: (event: PanelEvent) => void;
  /** The language to answer in, for `{{language}}`. */
  language: string;
  /** Runs `flush` before the next paint and returns a way to cancel that. */
  frame: (flush: () => void) => () => void;
}

export interface Conversation {
  /** Once attached: restores this page's conversation, or summarizes the page. */
  open: () => Promise<void>;
  /** Starts over with a new summary of the page. */
  summarize: () => void;
  /** Asks a follow-up question about the page. */
  ask: (question: string) => void;
  /**
   * Runs the latest turn again. With `cut`, a page sent as it is (`nothing`)
   * is cut this once; the setting stays as it is.
   */
  retry: (options?: { cut?: boolean }) => void;
  /** Ends the request in flight; what arrived stays. */
  stop: () => void;
  /** Makes `id` the default model, then runs the latest turn again with it. */
  switchModel: (id: string) => void;
  /** The panel is going away: the request in flight ends, and nothing it reports is shown. */
  dispose: () => void;
}

/** How a page sent as it is gets cut when the service refused it as too long. */
export const CUT_RETRY_STRATEGY: CutStrategy = 'back';

/**
 * The panel's conversation with the model about one page
 * (docs/development-plan.md §4.4). It keeps the finished turns, builds each
 * request from them and the page as it is now, fits the page into the
 * model's context window, and saves the conversation after every answer.
 * There is never more than one request in flight: a new one ends the old
 * one, and nothing the old one reports is shown (§4.4, decision 6).
 */
export function createConversation(deps: ConversationDeps): Conversation {
  /** Finished turns: what follow-ups carry and what is saved. */
  let history: Exchange[] = [];
  /** The turn in flight, or the latest one if it failed or stopped empty. Not in `history`. */
  let pending: { question: string | null } | null = null;
  let run: AbortController | null = null;
  /** Bumped by `dispose`, so an `open` that was waiting does nothing more. */
  let generation = 0;

  // Each save holds the whole conversation, so only the newest counts; one at
  // a time, so an older one cannot land last.
  const save = createLatestOnly({
    send: deps.save,
    settled: ({ truncated }: { truncated: boolean }) =>
      deps.dispatch(
        truncated ? { type: 'snapshot', note: { kind: 'save-truncated' } } : { type: 'saved' },
      ),
    failed: (error) =>
      deps.dispatch({ type: 'snapshot', note: { kind: 'save-failed', detail: messageOf(error) } }),
  });

  const drop = () => {
    run?.abort();
    run = null;
  };

  function commit(exchange: Exchange) {
    history = [...history, exchange];
    pending = null;
    save(toSnapshotMessages(history));
  }

  async function start(question: string | null, options: { cut?: boolean } = {}) {
    drop();
    const controller = new AbortController();
    run = controller;
    const current = () => run === controller;
    const fail = (problem: PanelProblem) => {
      if (!current()) return;
      run = null;
      deps.dispatch({ type: 'failed', problem });
    };
    pending = { question };
    deps.dispatch({ type: 'start', question, keep: history.length });

    let setup: RunSetup;
    try {
      setup = await deps.setup();
    } catch (error) {
      fail({ kind: 'config', detail: messageOf(error) });
      return;
    }
    if (!current()) return;
    deps.dispatch({ type: 'models', models: setup.choices, modelId: setup.config?.id ?? null });
    const { config, prompt } = setup;
    if (config === null) return fail({ kind: 'no-model' });
    if (prompt === null) return fail({ kind: 'no-prompt' });

    let page: PageContext;
    try {
      page = await deps.extract();
    } catch (error) {
      fail({ kind: 'extract', detail: messageOf(error) });
      return;
    }
    if (!current()) return;
    if (page.text.trim() === '') return fail({ kind: 'empty-page' });

    const strategy =
      options.cut === true && setup.trimming === 'nothing' ? CUT_RETRY_STRATEGY : setup.trimming;
    const past = toHistoryMessages(history);
    const build = (content: string) =>
      conversationMessages(prompt, promptValues(page, content, deps.language), past, question);
    const plan = planContent({
      content: pageContent(page),
      strategy,
      contextWindow: config.contextWindow,
      measure: (content) => estimateMessages(build(content)),
      occurrences: countVariable(prompt.system, 'content') + countVariable(prompt.user, 'content'),
    });
    if (plan.kind === 'too-long') {
      const { requiredTokens, contextWindow, assumedWindow } = plan;
      return fail({ kind: 'too-long', requiredTokens, contextWindow, assumedWindow });
    }
    const window: BudgetWindow | null =
      plan.kind === 'unchecked'
        ? null
        : {
            contextWindow: config.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
            assumedWindow: config.contextWindow === null,
          };

    const messages = build(plan.content);
    deps.dispatch({
      type: 'requesting',
      origin: new URL(config.baseURL).origin,
      cut: cutNote(plan, page.truncated),
    });

    // One render per frame, however fast the tokens come.
    let answer = '';
    let unsent = '';
    let scheduled = false;
    let cancel = () => {};
    const flush = () => {
      scheduled = false;
      if (unsent !== '' && current()) deps.dispatch({ type: 'text', text: unsent });
      unsent = '';
    };
    const outcome = await deps.stream({
      config,
      messages,
      signal: controller.signal,
      onText: (text) => {
        answer += text;
        unsent += text;
        if (scheduled) return;
        scheduled = true;
        cancel = deps.frame(flush);
      },
    });
    if (scheduled) cancel();
    flush();
    if (!current()) return;

    const estimate = { input: estimateMessages(messages), output: estimateTokens(answer) };
    switch (outcome.kind) {
      case 'done': {
        if (answer === '') return fail({ kind: 'empty-answer' });
        run = null;
        const usage = turnUsage(outcome.usage, estimate);
        deps.dispatch({ type: 'finished', usage });
        commit({ question, answer, stopped: false, usage });
        return;
      }
      case 'stopped': {
        run = null;
        // A stopped stream reports no usage: the estimate is all there is.
        const usage = answer === '' ? null : turnUsage(null, estimate);
        deps.dispatch({ type: 'stopped', usage });
        if (usage !== null) commit({ question, answer, stopped: true, usage });
        return;
      }
      case 'error':
        return fail({ kind: 'llm', error: outcome.error, window });
    }
  }

  function retry(options: { cut?: boolean } = {}) {
    if (pending !== null) {
      void start(pending.question, options);
      return;
    }
    const last = history.at(-1);
    history = history.slice(0, -1);
    void start(last?.question ?? null, options);
  }

  const pick = createModelSwitcher({
    choose: deps.choose,
    chosen: () => retry(),
    failed: (error) => {
      drop();
      deps.dispatch({ type: 'failed', problem: { kind: 'switch', detail: messageOf(error) } });
    },
  });

  return {
    async open() {
      const opened = generation;
      let saved: SnapshotView = { status: 'none' };
      try {
        saved = await deps.restore();
      } catch (error) {
        if (opened !== generation) return;
        deps.dispatch({
          type: 'snapshot',
          note: { kind: 'restore-failed', detail: messageOf(error) },
        });
      }
      if (opened !== generation) return;

      // Triggered again on a page with a conversation: restore it instead of
      // summarizing anew (docs/development-plan.md §4.4, decision 3).
      const exchanges = saved.status === 'found' ? toExchanges(saved.messages) : [];
      if (saved.status === 'found' && exchanges.length > 0) {
        history = exchanges;
        pending = null;
        deps.dispatch({ type: 'restored', exchanges, truncated: saved.truncated });
        try {
          const setup = await deps.setup();
          if (opened === generation) {
            const modelId = setup.config?.id ?? null;
            deps.dispatch({ type: 'models', models: setup.choices, modelId });
          }
        } catch {
          // The menu fills in with the next request.
        }
        return;
      }
      if (saved.status === 'evicted') {
        deps.dispatch({ type: 'snapshot', note: { kind: 'evicted' } });
      }
      void start(null);
    },

    summarize() {
      history = [];
      pending = null;
      void start(null);
    },

    ask(question) {
      const text = question.trim();
      if (text === '' || run !== null || history.length === 0) return;
      void start(text);
    },

    retry,

    stop() {
      run?.abort();
    },

    switchModel(id) {
      drop();
      deps.dispatch({ type: 'select', modelId: id });
      pick(id);
    },

    dispose() {
      generation += 1;
      drop();
    },
  };
}

function cutNote(plan: ContentPlan, extractionCut: boolean): CutNote | null {
  if (plan.kind === 'trimmed') {
    const { strategy, keptTokens, totalTokens, contextWindow, assumedWindow } = plan;
    return { kind: 'budget', strategy, keptTokens, totalTokens, contextWindow, assumedWindow };
  }
  return extractionCut ? { kind: 'extraction' } : null;
}

/** The conversation as a request carries it: answers and the questions between them. */
function toHistoryMessages(history: readonly Exchange[]): HistoryMessage[] {
  return history.flatMap((exchange) => [
    ...(exchange.question === null ? [] : [{ role: 'user' as const, content: exchange.question }]),
    { role: 'assistant' as const, content: exchange.answer },
  ]);
}

/** The conversation as it is saved: never the page, never a credential. */
export function toSnapshotMessages(history: readonly Exchange[]): SnapshotMessage[] {
  return history.flatMap((exchange): SnapshotMessage[] => [
    ...(exchange.question === null ? [] : [{ role: 'user' as const, content: exchange.question }]),
    {
      role: 'assistant',
      content: exchange.answer,
      stopped: exchange.stopped,
      usage: exchange.usage,
    },
  ]);
}

/** Saved messages back into turns: each answer with the question just before it, if any. */
export function toExchanges(messages: readonly SnapshotMessage[]): Exchange[] {
  const exchanges: Exchange[] = [];
  let question: string | null = null;
  for (const message of messages) {
    if (message.role === 'user') {
      question = message.content;
      continue;
    }
    const { content: answer, stopped, usage } = message;
    exchanges.push({ question, answer, stopped, usage });
    question = null;
  }
  return exchanges;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
