import type { TrimmingStrategy } from '@/contract/general-settings';
import type { ChatMessage } from '@/domain/llm/request';
import { LATE_START_NOTE, OMISSION_NOTE, TRUNCATION_NOTE } from '@/domain/prompt/messages';
import { estimateTokens, fitTokens } from '@/domain/token-estimate';

/**
 * The context window assumed for a model whose configuration leaves it
 * blank. Most hosted models take more. A local model often takes less, and
 * may cut what does not fit without a word, which is why the settings page
 * asks for the real figure (docs/development-plan.md risk 9).
 */
export const DEFAULT_CONTEXT_WINDOW = 64_000;

/**
 * What a message costs beyond its text (role and separators), and what the
 * reply's priming costs. Generous, like the estimate itself.
 */
export const MESSAGE_OVERHEAD_TOKENS = 4;
export const REPLY_OVERHEAD_TOKENS = 3;

/** Estimated tokens of a request's messages. */
export function estimateMessages(messages: readonly Pick<ChatMessage, 'content'>[]): number {
  return messages.reduce(
    (sum, message) => sum + estimateTokens(message.content) + MESSAGE_OVERHEAD_TOKENS,
    REPLY_OVERHEAD_TOKENS,
  );
}

/**
 * Room kept for the answer: a quarter of the window, at least 1,024 and at
 * most 8,192 tokens, and never more than half the window, so a small one
 * still leaves room for the input (#28). Nothing is sent to enforce it (no
 * `max_tokens`, §4.2 decision 1); it only keeps the input from filling the
 * whole window.
 */
export function outputReserve(contextWindow: number): number {
  return Math.min(
    8_192,
    Math.max(1_024, Math.floor(contextWindow / 4)),
    Math.floor(contextWindow / 2),
  );
}

/** The strategies that cut something. */
export type CutStrategy = Exclude<TrimmingStrategy, 'nothing'>;

export interface Trimmed {
  /** The text to send, with a note where it was cut. */
  text: string;
  /** Estimated tokens of the page text kept, notes left out. */
  keptTokens: number;
  /** False when the whole text fitted, so nothing was cut and no note added. */
  cut: boolean;
}

const BREAK = '\n\n';

/**
 * Cuts `text` to at most `maxTokens` estimated tokens, notes included,
 * taking the end (`back`), the middle (`middle`) or the start (`front`) away.
 * Null when not even the note fits beside a single character. Cuts fall
 * between code points, never inside a character.
 */
export function trimText(text: string, strategy: CutStrategy, maxTokens: number): Trimmed | null {
  const total = estimateTokens(text);
  if (total <= maxTokens) return { text, keptTokens: total, cut: false };

  const codePoints = Array.from(text);
  const take = (from: 'start' | 'end', limit: number) => {
    const count = fitTokens(codePoints, limit, from);
    return from === 'start'
      ? codePoints.slice(0, count).join('')
      : codePoints.slice(codePoints.length - count).join('');
  };
  const fits = (note: string, kept: string) =>
    kept === '' ? null : { text: note, keptTokens: estimateTokens(kept), cut: true };

  switch (strategy) {
    case 'back': {
      const note = `${BREAK}${TRUNCATION_NOTE}`;
      const kept = take('start', maxTokens - estimateTokens(note));
      return fits(kept + note, kept);
    }
    case 'front': {
      const note = `${LATE_START_NOTE}${BREAK}`;
      const kept = take('end', maxTokens - estimateTokens(note));
      return fits(note + kept, kept);
    }
    case 'middle': {
      const note = `${BREAK}${OMISSION_NOTE}${BREAK}`;
      const room = maxTokens - estimateTokens(note);
      const head = take('start', Math.ceil(room / 2));
      // The tail gets what the head left over. The two cannot meet: together
      // they stay within `room`, and the whole text does not.
      const tail = take('end', room - estimateTokens(head));
      if (head === '' || tail === '') return null;
      return {
        text: head + note + tail,
        keptTokens: estimateTokens(head) + estimateTokens(tail),
        cut: true,
      };
    }
  }
}

export interface ContentBudget {
  /** The page text as the prompt would carry it (`pageContent`). */
  content: string;
  strategy: TrimmingStrategy;
  /** From the model configuration; blank means `DEFAULT_CONTEXT_WINDOW`. */
  contextWindow: number | null;
  /** Estimated tokens of the whole request with `content` in it (`estimateMessages`). */
  measure: (content: string) => number;
  /** How many times the request carries the content: once per `{{content}}`. */
  occurrences: number;
}

interface Window {
  contextWindow: number;
  /** The configuration leaves the window blank; `DEFAULT_CONTEXT_WINDOW` stands in. */
  assumedWindow: boolean;
}

export type ContentPlan =
  /** Send the content as it is: everything fits. */
  | { kind: 'fits'; content: string }
  /** Send the content as it is, unchecked: the user chose `nothing`. */
  | { kind: 'unchecked'; content: string }
  /** Send the content cut down to what fits. */
  | ({
      kind: 'trimmed';
      content: string;
      strategy: CutStrategy;
      keptTokens: number;
      totalTokens: number;
    } & Window)
  /** Nothing can be sent: the prompt and the conversation alone leave no room for the page. */
  | ({ kind: 'too-long'; requiredTokens: number } & Window);

/**
 * Decides how much of the page a request can carry
 * (docs/development-plan.md §4.4, decision 4): the input budget is the
 * context window minus the room kept for the answer minus everything else in
 * the request (the prompt, the conversation so far, the new question). The
 * prompt and the conversation are never cut, only the page.
 */
export function planContent(budget: ContentBudget): ContentPlan {
  const { content, strategy, measure, occurrences } = budget;
  if (strategy === 'nothing') return { kind: 'unchecked', content };

  const window: Window = {
    contextWindow: budget.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    assumedWindow: budget.contextWindow === null,
  };
  const limit = window.contextWindow - outputReserve(window.contextWindow);
  if (measure(content) <= limit) return { kind: 'fits', content };

  const overhead = measure('');
  const tooLong = {
    kind: 'too-long',
    requiredTokens: overhead + (window.contextWindow - limit),
    ...window,
  } as const;
  if (occurrences === 0 || overhead >= limit) return tooLong;

  // Each occurrence gets an equal share. The estimate of a whole message can
  // differ from its parts by rounding, so check the result and shrink until
  // it fits; each round takes away at least one token.
  let room = Math.floor((limit - overhead) / occurrences);
  for (;;) {
    const trimmed = trimText(content, strategy, room);
    if (trimmed === null) return tooLong;
    const excess = measure(trimmed.text) - limit;
    if (excess <= 0) {
      return {
        kind: 'trimmed',
        content: trimmed.text,
        strategy,
        keptTokens: trimmed.keptTokens,
        totalTokens: estimateTokens(content),
        ...window,
      };
    }
    room -= Math.max(1, Math.ceil(excess / occurrences));
  }
}
