import type { ModelChoice } from '@/contract/rpc';
import type { PanelMode } from '@/contract/rpc-wire';
import type { TurnUsage } from '@/contract/snapshot';
import type { CutStrategy } from '@/domain/budget';
import type { LlmError } from '@/domain/llm/errors';

/** A prompt in the panel's menu: its name, never its templates. */
export interface PromptChoice {
  id: string;
  name: string;
}

/** The context window a request was budgeted for. */
export interface BudgetWindow {
  contextWindow: number;
  /** The configuration leaves the window blank; the default stood in. */
  assumedWindow: boolean;
}

/** Why a run could not finish. */
export type PanelProblem =
  | { kind: 'attach' }
  | { kind: 'no-model' }
  | { kind: 'no-prompt' }
  | { kind: 'config'; detail: string }
  /** The model picked from the menu could not be made the default. */
  | { kind: 'switch'; detail: string }
  | { kind: 'extract'; detail: string }
  | { kind: 'empty-page' }
  /** Opened on the selection, but nothing was selected. */
  | { kind: 'empty-selection' }
  /** The prompt and the conversation alone fill the context window. */
  | ({ kind: 'too-long'; requiredTokens: number } & BudgetWindow)
  /** The model finished without a word. */
  | { kind: 'empty-answer' }
  /**
   * The model failed. `window` is what the request was budgeted for, or null
   * when the page was sent as it is (`nothing`): then a context-length
   * refusal offers to cut and retry.
   */
  | { kind: 'llm'; error: LlmError; window: BudgetWindow | null };

/** How the page text of a request was cut, when it was. */
export type CutNote =
  | ({
      kind: 'budget';
      strategy: CutStrategy;
      keptTokens: number;
      totalTokens: number;
    } & BudgetWindow)
  /** Only extraction's fixed limit cut it. */
  | { kind: 'extraction' };

/** One question and its answer; the summary has no question. */
export interface Turn {
  question: string | null;
  /** The answer so far, as Markdown. */
  text: string;
  /**
   * The model's reasoning, shown folded (§4.5, decision 3). Never saved,
   * copied or sent again: a restored turn has none.
   */
  reasoning: string;
  status: 'pending' | 'done' | 'stopped' | 'failed';
  usage: TurnUsage | null;
  cut: CutNote | null;
}

/** About the saved copy of the conversation (docs/development-plan.md §4.4, decision 2). */
export type SnapshotNote =
  /** Restored, but the oldest messages had been left out to fit. */
  | { kind: 'restored-truncated' }
  /** There was a conversation for this page; it was evicted to make room. */
  | { kind: 'evicted' }
  | { kind: 'restore-failed'; detail: string }
  /** Saved without the oldest messages, which did not fit. */
  | { kind: 'save-truncated' }
  | { kind: 'save-failed'; detail: string };

/**
 * The panel: the conversation so far, and the phase of its latest run,
 * extracting → requesting → streaming → done / stopped / error
 * (docs/development-plan.md §4.2). Before the first run it is attaching;
 * after restoring a saved conversation, restored; when the settings say not
 * to summarize on opening, ready until the user asks for one. Text received before a
 * stop or an error stays on screen.
 */
export interface PanelState {
  phase:
    | 'attaching'
    | 'ready'
    | 'restored'
    | 'extracting'
    | 'requesting'
    | 'streaming'
    | 'done'
    | 'stopped'
    | 'error';
  /** What the panel works on: the page, or the selection (§4.6). */
  mode: PanelMode;
  /** What the model menu offers, as last read. Kept across runs, so the menu does not flicker. */
  models: ModelChoice[];
  /** The model in use: the global default, or the one just picked from the menu. */
  modelId: string | null;
  /** What the prompt menu offers (names only), as last read. */
  prompts: PromptChoice[];
  /** The prompt summaries use: the global default, or the one just picked from the menu. */
  promptId: string | null;
  /** Origin of the model service, for error messages. */
  origin: string | null;
  /**
   * The request failed before anything arrived and goes once more after this
   * many seconds (§4.5, decision 1); null otherwise.
   */
  retrying: number | null;
  turns: Turn[];
  /** Why the latest run did not finish; it belongs to the last turn, if there is one. */
  problem: PanelProblem | null;
  snapshot: SnapshotNote | null;
}

/** A finished turn as the conversation keeps it. */
export interface Exchange {
  question: string | null;
  answer: string;
  stopped: boolean;
  usage: TurnUsage | null;
}

export type PanelEvent =
  /** Attached, and waiting for the user to ask for a summary. */
  | { type: 'ready' }
  /** A saved conversation is shown instead of a new summary. */
  | { type: 'restored'; exchanges: Exchange[]; truncated: boolean }
  /** A new turn begins after the first `keep` turns; the others are gone. */
  | { type: 'start'; question: string | null; keep: number }
  | { type: 'models'; models: ModelChoice[]; modelId: string | null }
  | { type: 'prompts'; prompts: PromptChoice[]; promptId: string | null }
  /** The panel was opened on the selection. */
  | { type: 'mode'; mode: PanelMode }
  /**
   * A model picked from the menu, with one of its model names when the menu
   * offers several: the latest turn runs again with it, unless
   * the panel is `waiting` for the user to ask for a summary.
   */
  | { type: 'select'; modelId: string; model?: string; waiting?: boolean }
  /**
   * A prompt picked from the menu: a new summary starts with it once the
   * pick is stored, unless the panel is `waiting` for the user to ask for one.
   */
  | { type: 'selectPrompt'; promptId: string; waiting?: boolean }
  | { type: 'requesting'; origin: string; cut: CutNote | null }
  /** The request is sent once more after `seconds`. */
  | { type: 'retrying'; seconds: number }
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'finished'; usage: TurnUsage }
  | { type: 'stopped'; usage: TurnUsage | null }
  | { type: 'failed'; problem: PanelProblem }
  | { type: 'snapshot'; note: SnapshotNote }
  /** The conversation was saved in full: an earlier saving problem is over. */
  | { type: 'saved' };

export const INITIAL_PANEL_STATE: PanelState = {
  phase: 'attaching',
  mode: 'page',
  models: [],
  modelId: null,
  prompts: [],
  promptId: null,
  origin: null,
  retrying: null,
  turns: [],
  problem: null,
  snapshot: null,
};

export function isBusy(state: PanelState): boolean {
  return (
    state.phase === 'extracting' || state.phase === 'requesting' || state.phase === 'streaming'
  );
}

/** A follow-up needs an answer to follow, and nothing in flight. */
export function canAsk(state: PanelState): boolean {
  return !isBusy(state) && state.turns.some(isAnswered);
}

/** A turn the conversation keeps: finished or stopped, with an answer. */
export function isAnswered(turn: Turn): boolean {
  return (turn.status === 'done' || turn.status === 'stopped') && turn.text !== '';
}

/** Display name of the model in use, or empty while unknown. */
export function modelName(state: PanelState): string {
  return state.models.find((model) => model.id === state.modelId)?.name ?? '';
}

/** The model in use as the menu shows it: its configuration, and its model name. */
export function modelTitle(state: PanelState): string {
  const choice = state.models.find((model) => model.id === state.modelId);
  if (choice === undefined) return '';
  return choice.name === choice.model ? choice.name : `${choice.name} · ${choice.model}`;
}

export function reducePanel(state: PanelState, event: PanelEvent): PanelState {
  switch (event.type) {
    case 'ready':
      return { ...state, phase: 'ready' };
    case 'restored':
      return {
        ...state,
        phase: 'restored',
        turns: event.exchanges.map((exchange) => ({
          question: exchange.question,
          text: exchange.answer,
          reasoning: '',
          status: exchange.stopped ? 'stopped' : 'done',
          usage: exchange.usage,
          cut: null,
        })),
        problem: null,
        snapshot: event.truncated ? { kind: 'restored-truncated' } : state.snapshot,
      };
    case 'start':
      return {
        ...state,
        phase: 'extracting',
        origin: null,
        retrying: null,
        turns: [
          ...state.turns.slice(0, event.keep),
          {
            question: event.question,
            text: '',
            reasoning: '',
            status: 'pending',
            usage: null,
            cut: null,
          },
        ],
        problem: null,
      };
    case 'models':
      return { ...state, models: event.models, modelId: event.modelId };
    case 'prompts':
      return { ...state, prompts: event.prompts, promptId: event.promptId };
    case 'mode':
      return { ...state, mode: event.mode };
    case 'selectPrompt':
      // Waiting, the pick only changes the default: a failed pick before it is over.
      if (event.waiting === true) {
        return { ...state, phase: 'ready', promptId: event.promptId, problem: null };
      }
      // What is on screen stays until the new summary starts.
      return {
        ...state,
        phase: 'extracting',
        promptId: event.promptId,
        retrying: null,
        problem: null,
      };
    case 'select': {
      // The menu shows the pick at once; the next read of the settings confirms it.
      const models =
        event.model === undefined
          ? state.models
          : state.models.map((choice) =>
              choice.id === event.modelId
                ? { ...choice, model: event.model ?? choice.model }
                : choice,
            );
      if (event.waiting === true) {
        return { ...state, phase: 'ready', models, modelId: event.modelId, problem: null };
      }
      // The run in flight is dropped; the turn starts again once the pick is stored.
      return {
        ...state,
        phase: 'extracting',
        models,
        modelId: event.modelId,
        retrying: null,
        problem: null,
      };
    }
    case 'requesting':
      return {
        ...state,
        phase: 'requesting',
        origin: event.origin,
        retrying: null,
        turns: updateLast(state.turns, (turn) => ({ ...turn, cut: event.cut })),
      };
    case 'retrying':
      return state.phase === 'requesting' ? { ...state, retrying: event.seconds } : state;
    case 'text':
      // A late chunk after a stop or an error changes nothing.
      if (state.phase !== 'requesting' && state.phase !== 'streaming') return state;
      return {
        ...state,
        phase: 'streaming',
        retrying: null,
        turns: updateLast(state.turns, (turn) => ({ ...turn, text: turn.text + event.text })),
      };
    case 'reasoning':
      if (state.phase !== 'requesting' && state.phase !== 'streaming') return state;
      return {
        ...state,
        phase: 'streaming',
        retrying: null,
        turns: updateLast(state.turns, (turn) => ({
          ...turn,
          reasoning: turn.reasoning + event.text,
        })),
      };
    case 'finished':
      if (!isBusy(state)) return state;
      return {
        ...state,
        phase: 'done',
        retrying: null,
        turns: updateLast(state.turns, (turn) => ({ ...turn, status: 'done', usage: event.usage })),
      };
    case 'stopped':
      if (!isBusy(state)) return state;
      return {
        ...state,
        phase: 'stopped',
        retrying: null,
        // Stopped during a pick, before its turn began again: the turn on
        // screen keeps what it was.
        turns: updateLast(state.turns, (turn) =>
          turn.status === 'pending' ? { ...turn, status: 'stopped', usage: event.usage } : turn,
        ),
      };
    case 'failed':
      return {
        ...state,
        phase: 'error',
        retrying: null,
        problem: event.problem,
        turns: updateLast(state.turns, (turn) =>
          turn.status === 'pending' ? { ...turn, status: 'failed' } : turn,
        ),
      };
    case 'snapshot':
      return { ...state, snapshot: event.note };
    case 'saved':
      return state.snapshot?.kind === 'save-failed' || state.snapshot?.kind === 'save-truncated'
        ? { ...state, snapshot: null }
        : state;
  }
}

function updateLast(turns: Turn[], change: (turn: Turn) => Turn): Turn[] {
  const last = turns.at(-1);
  return last === undefined ? turns : [...turns.slice(0, -1), change(last)];
}
