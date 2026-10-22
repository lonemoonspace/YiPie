import type { AnswerLanguage, TrimmingStrategy } from '@/contract/general-settings';
import type { PageContext } from '@/contract/page-context';
import type { PromptConfig } from '@/contract/prompt-config';
import type { ModelChoice, PanelModelConfig, SnapshotView } from '@/contract/rpc';
import type { PanelMode } from '@/contract/rpc-wire';
import {
  SNAPSHOT_MESSAGE_LENGTH,
  SNAPSHOT_PAGE_BYTES,
  type SnapshotMessage,
} from '@/contract/snapshot';
import { resolveAnswerLanguage, type ResolvedLanguage } from '@/domain/answer-language';
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
import { createModelSwitcher, type ModelPick } from './model-switcher';
import type {
  BudgetWindow,
  CutNote,
  Exchange,
  PanelEvent,
  PanelProblem,
  PromptChoice,
} from './state';

/** What a run reads before it starts: always fresh, so the panel follows the settings. */
export interface RunSetup {
  /** The model menu, without credentials. */
  choices: ModelChoice[];
  /** The model in use, with its key; null when there is none. */
  config: PanelModelConfig | null;
  /** The default prompt; null when there is none. */
  prompt: Pick<PromptConfig, 'system' | 'user'> | null;
  /** The prompt menu: names only. */
  prompts: PromptChoice[];
  /** The default prompt's id; null when there is none. */
  promptId: string | null;
  trimming: TrimmingStrategy;
  answerLanguage: AnswerLanguage;
  /** Opening the panel on the page summarizes it right away; off, it waits for `summarize`. */
  autoSummarize: boolean;
}

export interface StreamRequest {
  config: PanelModelConfig;
  messages: ChatMessage[];
  signal: AbortSignal;
  onText: (text: string) => void;
  onReasoning: (text: string) => void;
  onRetry: (retry: { seconds: number }) => void;
  onStreamOptionsRejected: () => void;
}

export interface ConversationDeps {
  setup: () => Promise<RunSetup>;
  /** The conversation saved for this page in this tab (`snapshot.get`). */
  restore: () => Promise<SnapshotView>;
  /** The page as it is now (`page.getContext`). */
  extract: () => Promise<PageContext>;
  /** Streams one answer; never throws (`streamChat`). */
  stream: (request: StreamRequest) => Promise<ChatOutcome>;
  /**
   * Saves the whole conversation (`snapshot.save`). The background keeps the
   * save with the highest revision this panel sent, whatever order they
   * arrive in.
   */
  save: (messages: SnapshotMessage[], revision: number) => Promise<{ truncated: boolean }>;
  /** Makes a model the default (`models.choose`). */
  choose: (pick: ModelPick) => Promise<unknown>;
  /** Makes a prompt the default (`prompts.choose`). */
  choosePrompt: (id: string) => Promise<unknown>;
  /** The service of a model refused `stream_options` (`models.disableStreamUsage`). */
  disableStreamUsage: (id: string) => Promise<unknown>;
  dispatch: (event: PanelEvent) => void;
  /** The name of the language to answer in, for `{{language}}`. */
  language: (language: ResolvedLanguage) => string;
  /** Runs `flush` before the next paint and returns a way to cancel that. */
  frame: (flush: () => void) => () => void;
}

export interface Conversation {
  /**
   * Once attached: restores this page's conversation, or summarizes the
   * page; with `autoSummarize` off, it waits for `summarize` instead. A
   * panel opened on the selection always summarizes that, and keeps
   * its conversation to itself: nothing is restored or saved, so the page's
   * own conversation stays as it was (docs/development-plan.md §4.6).
   */
  open: (mode?: PanelMode) => Promise<void>;
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
  /** Makes the pick the default model, then runs the latest turn again with it. */
  switchModel: (pick: ModelPick) => void;
  /** Makes `id` the default prompt, then starts over with a new summary that uses it. */
  switchPrompt: (id: string) => void;
  /**
   * The panel is going away: the request in flight ends, and nothing still
   * on its way is shown or acted on (a save's result, a model pick, a
   * restore). A save already sent is still stored: it is the conversation.
   */
  dispose: () => void;
}

/** How a page sent as it is gets cut when the service refused it as too long. */
export const CUT_RETRY_STRATEGY: CutStrategy = 'back';

/**
 * The panel's conversation with the model about one page
 * (docs/development-plan.md §4.4). It keeps the finished turns, builds each
 * request from them and the page as it is now, fits the page into the
 * model's context window, and saves the conversation whenever its finished
 * turns change. There is never more than one request in flight: a new one
 * ends the old one, and nothing the old one reports is shown (§4.4,
 * decision 6).
 *
 * Every step that waits (a restore, a model pick) belongs to the action that
 * started it, and goes no further once the user has done something else or
 * the panel has gone away.
 */
export function createConversation(deps: ConversationDeps): Conversation {
  /** Finished turns: what follow-ups carry and what is saved. */
  let history: Exchange[] = [];
  /** The turn in flight, or the latest one if it failed or stopped empty. Not in `history`. */
  let pending: { question: string | null } | null = null;
  let run: AbortController | null = null;
  /** Counts actions (open, a request, a pick from a menu, dispose): a waiting step checks it is still the latest. */
  let action = 0;
  /** The action of the newest pick from either menu; 0 once a pick failed. */
  let picked = 0;
  /** Bumped by `dispose`: a save answered after it is not shown. */
  let generation = 0;
  /** Counts saves: the background keeps the newest, and only the newest one's result is shown. */
  let revision = 0;
  /** What the panel works on; a selection conversation is never saved. */
  let mode: PanelMode = 'page';
  /** Opened without a summary, as the settings ask: a model pick only changes the default. */
  let waiting = false;

  /** Fills both menus from what the settings say now. */
  const menus = (setup: RunSetup) => {
    deps.dispatch({ type: 'models', models: setup.choices, modelId: setup.config?.id ?? null });
    deps.dispatch({ type: 'prompts', prompts: setup.prompts, promptId: setup.promptId });
  };

  const drop = () => {
    run?.abort();
    run = null;
  };

  /**
   * Saves the finished turns as they are now. It goes out at once, carrying
   * its revision: whatever order saves arrive in, the background keeps the
   * newest (PR #4 review). An empty conversation means the user started
   * over, so nothing older can be restored once it is stored.
   */
  function persist() {
    if (mode === 'selection') return;
    const sent = ++revision;
    const life = generation;
    const shown = () => sent === revision && life === generation;
    const messages = toSnapshotMessages(history);
    const cut = history.some(
      ({ question, answer }) =>
        savedText(answer) !== answer || (question !== null && savedText(question) !== question),
    );
    deps.save(messages, sent).then(
      ({ truncated }) => {
        if (!shown()) return;
        deps.dispatch(
          truncated || cut
            ? { type: 'snapshot', note: { kind: 'save-truncated' } }
            : { type: 'saved' },
        );
      },
      (error: unknown) => {
        if (!shown()) return;
        deps.dispatch({
          type: 'snapshot',
          note: { kind: 'save-failed', detail: messageOf(error) },
        });
      },
    );
  }

  function commit(exchange: Exchange) {
    history = [...history, exchange];
    pending = null;
    persist();
  }

  async function start(question: string | null, options: { cut?: boolean } = {}) {
    action += 1;
    waiting = false;
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
    menus(setup);
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
    const onSelection = mode === 'selection';
    if (onSelection && page.selection.trim() === '') return fail({ kind: 'empty-selection' });
    if (!onSelection && page.text.trim() === '') return fail({ kind: 'empty-page' });

    const strategy =
      options.cut === true && setup.trimming === 'nothing' ? CUT_RETRY_STRATEGY : setup.trimming;
    const past = toHistoryMessages(history);
    const language = deps.language(resolveAnswerLanguage(setup.answerLanguage, page.lang));
    const build = (content: string) =>
      conversationMessages(prompt, promptValues(page, content, language), past, question);
    const plan = planContent({
      content: onSelection ? page.selection : pageContent(page),
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
      cut: cutNote(plan, !onSelection && page.truncated),
    });

    // One render per frame, however fast the tokens come.
    let answer = '';
    let reasoning = '';
    let unsent = '';
    let unsentReasoning = '';
    let scheduled = false;
    let cancel = () => {};
    const flush = () => {
      scheduled = false;
      if (unsentReasoning !== '' && current()) {
        deps.dispatch({ type: 'reasoning', text: unsentReasoning });
      }
      if (unsent !== '' && current()) deps.dispatch({ type: 'text', text: unsent });
      unsent = '';
      unsentReasoning = '';
    };
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      cancel = deps.frame(flush);
    };
    const outcome = await deps.stream({
      config,
      messages,
      signal: controller.signal,
      onText: (text) => {
        answer += text;
        unsent += text;
        schedule();
      },
      onReasoning: (text) => {
        reasoning += text;
        unsentReasoning += text;
        schedule();
      },
      onRetry: ({ seconds }) => {
        if (current()) deps.dispatch({ type: 'retrying', seconds });
      },
      // Remembered for the next request, whoever makes it (§4.5, decision 2).
      // Should this fail, the next request is refused once more and the
      // client asks again without the field.
      onStreamOptionsRejected: () => {
        deps.disableStreamUsage(config.id).catch(() => undefined);
      },
    });
    if (scheduled) cancel();
    flush();
    if (!current()) return;

    // Reasoning is output the service bills for, though it is not the answer.
    const estimate = {
      input: estimateMessages(messages),
      output: estimateTokens(reasoning + answer),
    };
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
    // The latest finished turn is answered again: the saved conversation
    // loses it now, as the panel does.
    const last = history.at(-1);
    if (last !== undefined) {
      history = history.slice(0, -1);
      persist();
    }
    void start(last?.question ?? null, options);
  }

  /** Starts over: the saved conversation is cleared now, as the panel shows it. */
  function restart() {
    const cleared = history.length > 0;
    history = [];
    pending = null;
    if (cleared) persist();
    void start(null);
  }

  // A model pick and a prompt pick go out on their own queues. What follows
  // them waits until neither is still on its way, so the run reads both new
  // defaults: a new summary if the prompt changed, otherwise the latest turn
  // again with the new model. Only the newest pick of each menu reports
  // (createLatestOnly), and nothing follows once the user has done something
  // else or the panel has gone away.
  let modelPicking = false;
  let promptPicking = false;
  let promptPicked = false;
  const follow = () => {
    if (modelPicking || promptPicking) return;
    const fresh = promptPicked;
    promptPicked = false;
    if (picked !== action || waiting) return;
    if (fresh) restart();
    else retry();
  };
  const pickFailed = (error: unknown) => {
    if (picked !== action) return;
    // The other menu's pick, if still on its way, starts nothing after this.
    picked = 0;
    promptPicked = false;
    drop();
    deps.dispatch({ type: 'failed', problem: { kind: 'switch', detail: messageOf(error) } });
  };
  const pickModel = createModelSwitcher({
    choose: deps.choose,
    chosen: () => {
      modelPicking = false;
      follow();
    },
    failed: (error) => {
      modelPicking = false;
      pickFailed(error);
    },
  });
  const pickPrompt = createLatestOnly({
    send: deps.choosePrompt,
    settled: () => {
      promptPicking = false;
      follow();
    },
    failed: (error) => {
      promptPicking = false;
      pickFailed(error);
    },
  });

  return {
    async open(opening = 'page') {
      const opened = ++action;
      const current = () => opened === action;
      mode = opening;
      if (mode === 'selection') {
        deps.dispatch({ type: 'mode', mode });
        void start(null);
        return;
      }
      let saved: SnapshotView = { status: 'none' };
      try {
        saved = await deps.restore();
      } catch (error) {
        if (!current()) return;
        deps.dispatch({
          type: 'snapshot',
          note: { kind: 'restore-failed', detail: messageOf(error) },
        });
      }
      // The user started something meanwhile (or the panel went away): the
      // saved conversation must not replace it.
      if (!current()) return;

      // Triggered again on a page with a conversation: restore it instead of
      // summarizing anew (docs/development-plan.md §4.4, decision 3).
      const exchanges = saved.status === 'found' ? toExchanges(saved.messages) : [];
      if (saved.status === 'found' && exchanges.length > 0) {
        history = exchanges;
        pending = null;
        deps.dispatch({ type: 'restored', exchanges, truncated: saved.truncated });
        try {
          const setup = await deps.setup();
          if (current()) menus(setup);
        } catch {
          // The menu fills in with the next request.
        }
        return;
      }
      if (saved.status === 'evicted') {
        deps.dispatch({ type: 'snapshot', note: { kind: 'evicted' } });
      }
      // The settings may ask the panel to wait for the user. If they cannot
      // be read, the summary goes ahead and reports why it could not run.
      let setup: RunSetup | null = null;
      try {
        setup = await deps.setup();
      } catch {
        // `start` reads them again and says what went wrong.
      }
      if (!current()) return;
      if (setup !== null && !setup.autoSummarize) {
        waiting = true;
        menus(setup);
        deps.dispatch({ type: 'ready' });
        return;
      }
      void start(null);
    },

    // Starting over clears the saved conversation now, as the panel does,
    // rather than when the new summary is done.
    summarize: restart,

    ask(question) {
      const text = question.trim();
      if (text === '' || run !== null || history.length === 0) return;
      void start(text);
    },

    retry,

    stop() {
      run?.abort();
    },

    switchModel(pick) {
      picked = ++action;
      drop();
      deps.dispatch({ type: 'select', modelId: pick.id, model: pick.model, waiting });
      modelPicking = true;
      pickModel(pick);
    },

    switchPrompt(id) {
      picked = ++action;
      drop();
      deps.dispatch({ type: 'selectPrompt', promptId: id, waiting });
      promptPicking = true;
      promptPicked = true;
      pickPrompt(id);
    },

    dispose() {
      action += 1;
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

/**
 * The conversation as it is saved: never the page, never a credential. A
 * message too long for a snapshot is cut to its start (`savedText`), and a
 * cut answer is saved as stopped: the background would refuse the whole save
 * otherwise, and every save after it.
 */
export function toSnapshotMessages(history: readonly Exchange[]): SnapshotMessage[] {
  return history.flatMap((exchange): SnapshotMessage[] => {
    const answer = savedText(exchange.answer);
    return [
      ...(exchange.question === null
        ? []
        : [{ role: 'user' as const, content: savedText(exchange.question) }]),
      {
        role: 'assistant',
        content: answer,
        stopped: exchange.stopped || answer !== exchange.answer,
        usage: exchange.usage,
      },
    ];
  });
}

/**
 * Room for one message in a page's snapshot, in bytes: the page's limit less
 * what goes around it (the page key, the other fields).
 */
const MESSAGE_BYTES = SNAPSHOT_PAGE_BYTES - 16 * 1024;

/**
 * The start of `text` that a snapshot can hold: at most
 * `SNAPSHOT_MESSAGE_LENGTH` characters (the schema), and few enough bytes,
 * as stored, that it fits a page's snapshot on its own. Both bounds count:
 * 200,000 Chinese characters are about 600 kB. Cut between characters.
 */
export function savedText(text: string): string {
  const bytes = (part: string) => byteLength(JSON.stringify(part));
  if (text.length <= SNAPSHOT_MESSAGE_LENGTH && bytes(text) <= MESSAGE_BYTES) return text;
  let fits = 0;
  let over = Math.min(text.length, SNAPSHOT_MESSAGE_LENGTH) + 1;
  while (over - fits > 1) {
    const middle = Math.floor((fits + over) / 2);
    if (bytes(text.slice(0, middle)) <= MESSAGE_BYTES) fits = middle;
    else over = middle;
  }
  // Not half a surrogate pair.
  const last = text.charCodeAt(fits - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? fits - 1 : fits);
}

const encoder = new TextEncoder();
const byteLength = (text: string) => encoder.encode(text).length;

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
