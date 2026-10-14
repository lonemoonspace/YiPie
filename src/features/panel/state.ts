import type { LlmError } from '@/domain/llm/errors';
import type { Usage } from '@/domain/llm/stream';

/** Why the panel could not finish, other than the model failing. */
export type PanelProblem =
  | { kind: 'attach' }
  | { kind: 'no-model' }
  | { kind: 'models'; detail: string }
  | { kind: 'extract'; detail: string }
  | { kind: 'empty-page' }
  | { kind: 'llm'; error: LlmError };

/** A model the panel can switch to: its name only, never its key. */
export interface ModelChoice {
  id: string;
  name: string;
}

/**
 * attaching → extracting → requesting → streaming → done / stopped / error
 * (docs/development-plan.md §4.2). Text received before a stop or an error
 * stays on screen.
 */
export interface PanelState {
  phase: 'attaching' | 'extracting' | 'requesting' | 'streaming' | 'done' | 'stopped' | 'error';
  /** Display name of the model in use, once known. */
  model: string | null;
  /** Origin of the model service, for error messages. */
  origin: string | null;
  /** The page text was cut before sending. */
  truncated: boolean;
  /** The answer so far, as Markdown. */
  text: string;
  usage: Usage | null;
  problem: PanelProblem | null;
  /** The models to choose from; kept across runs, so a failed run can switch. */
  choices: ModelChoice[];
  /** The default model, which runs use. */
  modelId: string | null;
}

export type PanelEvent =
  | { type: 'start' }
  | { type: 'setup'; choices: ModelChoice[]; modelId: string | null }
  /** The user picked another model; shown at once, before the run that uses it. */
  | { type: 'choose'; modelId: string }
  | { type: 'requesting'; model: string; origin: string; truncated: boolean }
  | { type: 'text'; text: string }
  | { type: 'finished'; usage: Usage | null }
  | { type: 'stopped' }
  | { type: 'failed'; problem: PanelProblem };

export const INITIAL_PANEL_STATE: PanelState = {
  phase: 'attaching',
  model: null,
  origin: null,
  truncated: false,
  text: '',
  usage: null,
  problem: null,
  choices: [],
  modelId: null,
};

export function isBusy(state: PanelState): boolean {
  return (
    state.phase === 'extracting' || state.phase === 'requesting' || state.phase === 'streaming'
  );
}

export function reducePanel(state: PanelState, event: PanelEvent): PanelState {
  switch (event.type) {
    case 'start':
      return {
        ...INITIAL_PANEL_STATE,
        phase: 'extracting',
        choices: state.choices,
        modelId: state.modelId,
      };
    case 'setup':
      return { ...state, choices: event.choices, modelId: event.modelId };
    case 'choose':
      return { ...state, modelId: event.modelId };
    case 'requesting':
      return {
        ...state,
        phase: 'requesting',
        model: event.model,
        origin: event.origin,
        truncated: event.truncated,
      };
    case 'text':
      // A late chunk after a stop or an error changes nothing.
      if (state.phase !== 'requesting' && state.phase !== 'streaming') return state;
      return { ...state, phase: 'streaming', text: state.text + event.text };
    case 'finished':
      return isBusy(state) ? { ...state, phase: 'done', usage: event.usage } : state;
    case 'stopped':
      return isBusy(state) ? { ...state, phase: 'stopped' } : state;
    case 'failed':
      return { ...state, phase: 'error', problem: event.problem };
  }
}
