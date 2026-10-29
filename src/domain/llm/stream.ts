import type { StreamFailure } from './errors';

export interface Usage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

export type StreamEvent =
  | { type: 'content'; text: string }
  /** The model's reasoning, apart from the answer (appendix D). */
  | { type: 'reasoning'; text: string }
  | { type: 'usage'; usage: Usage }
  /** The choice says why it ended: `stop`, `length` (the token limit)… */
  | { type: 'finish'; reason: string }
  /** The service reported a failure. */
  | { type: 'error'; failure: StreamFailure }
  /** The data breaks the protocol. */
  | { type: 'invalid'; message: string }
  | { type: 'done' };

/**
 * Turns the `data` of one server-sent event from a chat completions stream
 * into the events the panel cares about. The SSE framing (lines, comments,
 * events split across network chunks) is the parser's job; this function only
 * reads one payload.
 *
 * Reasoning comes as `delta.reasoning_content` (DeepSeek, vLLM) or
 * `delta.reasoning` (OpenRouter, Ollama), and never mixes into the answer;
 * reasoning written inline as `<think>…</think>` is `createThinkSplitter`'s.
 */
export function interpretEventData(data: string, event?: string): StreamEvent[] {
  const payload = data.trim();
  if (payload === '') return [];
  if (payload === '[DONE]') return [{ type: 'done' }];

  let chunk: unknown;
  try {
    chunk = JSON.parse(payload);
  } catch {
    // An `event: error` may carry plain text.
    if (event === 'error') return [{ type: 'error', failure: { message: clip(payload) } }];
    return [
      { type: 'invalid', message: `The service sent data that is not JSON: ${clip(payload)}` },
    ];
  }
  // An `event: error` may carry its message as a JSON string, too.
  if (event === 'error' && typeof chunk === 'string') {
    return [{ type: 'error', failure: failureOf(chunk) }];
  }
  if (!isRecord(chunk)) {
    return [{ type: 'invalid', message: `The service sent unexpected data: ${clip(payload)}` }];
  }

  // Some aggregators report a failure inside a 200 stream: as an `error`
  // field, or as an event named `error` (appendix D).
  if (chunk.error !== undefined && chunk.error !== null) {
    return [{ type: 'error', failure: failureOf(chunk.error) }];
  }
  if (event === 'error') return [{ type: 'error', failure: failureOf(chunk) }];

  const events: StreamEvent[] = [];
  const delta = firstDelta(chunk.choices);
  // A service that sends both fields sends the same text twice.
  const reasoning = [delta.reasoning_content, delta.reasoning].find(
    (value): value is string => typeof value === 'string' && value !== '',
  );
  if (reasoning !== undefined) events.push({ type: 'reasoning', text: reasoning });
  if (typeof delta.content === 'string' && delta.content !== '') {
    events.push({ type: 'content', text: delta.content });
  }

  // Usually its own final chunk with `choices: []`, but some servers attach
  // it to the last content chunk.
  const usage = readUsage(chunk.usage);
  if (usage) events.push({ type: 'usage', usage });

  const first: unknown = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined;
  const reason = isRecord(first) ? first.finish_reason : undefined;
  if (typeof reason === 'string' && reason !== '') events.push({ type: 'finish', reason });

  return events;
}

function firstDelta(choices: unknown): Record<string, unknown> {
  const first: unknown = Array.isArray(choices) ? choices[0] : undefined;
  return isRecord(first) && isRecord(first.delta) ? first.delta : {};
}

const OPEN = '<think>';
const CLOSE = '</think>';

/** Text of the answer, sorted into what the model reasoned and what it answered. */
export interface Sorted {
  reasoning: string;
  answer: string;
}

/**
 * Sorts an answer that carries its reasoning inline, as `<think>…</think>`
 * at its very start (local models such as DeepSeek R1 distills; appendix D),
 * piece by piece as it streams. A tag may be split across pieces, so a piece
 * that could be the start of one waits for the next. A `<think>` anywhere
 * but at the start is the answer's own text.
 */
export function createThinkSplitter() {
  let mode: 'start' | 'reasoning' | 'after' | 'answer' = 'start';
  let held = '';

  return {
    push(text: string): Sorted {
      const sorted: Sorted = { reasoning: '', answer: '' };
      held += text;
      for (;;) {
        if (mode === 'start') {
          const rest = held.trimStart();
          if (rest.startsWith(OPEN)) {
            mode = 'reasoning';
            held = rest.slice(OPEN.length);
            continue;
          }
          if (OPEN.startsWith(rest)) return sorted;
          mode = 'answer';
        }
        if (mode === 'reasoning') {
          const end = held.indexOf(CLOSE);
          if (end === -1) {
            const keep = partialTagAtEnd(held, CLOSE);
            sorted.reasoning += held.slice(0, held.length - keep);
            held = held.slice(held.length - keep);
            return sorted;
          }
          sorted.reasoning += held.slice(0, end);
          held = held.slice(end + CLOSE.length);
          mode = 'after';
        }
        if (mode === 'after') {
          // The answer starts after the blank lines that follow the tag.
          held = held.trimStart();
          if (held === '') return sorted;
          mode = 'answer';
        }
        sorted.answer += held;
        held = '';
        return sorted;
      }
    },

    /** What is still held when the stream ends. */
    flush(): Sorted {
      const rest = held;
      held = '';
      return mode === 'reasoning'
        ? { reasoning: rest, answer: '' }
        : { reasoning: '', answer: mode === 'after' ? '' : rest };
    },
  };
}

/** How many characters at the end of `text` could be the start of `tag`. */
function partialTagAtEnd(text: string, tag: string): number {
  for (let length = Math.min(text.length, tag.length - 1); length > 0; length -= 1) {
    if (text.endsWith(tag.slice(0, length))) return length;
  }
  return 0;
}

function readUsage(value: unknown): Usage | null {
  if (!isRecord(value)) return null;
  return {
    promptTokens: count(value.prompt_tokens),
    completionTokens: count(value.completion_tokens),
    totalTokens: count(value.total_tokens),
  };
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * What a failure in the stream says about itself: its message, an HTTP-like
 * code (`{"code": 502}`, `{"status": 429}`) and its type
 * (`{"type": "rate_limit_error"}`, `{"code": "insufficient_quota"}`).
 */
function failureOf(error: unknown): StreamFailure {
  // Cut like an error body: a service may send megabytes, and the panel shows it.
  if (typeof error === 'string') return { message: clip(error, MESSAGE_LIMIT) };
  if (!isRecord(error)) return { message: clip(JSON.stringify(error)) };
  const message =
    typeof error.message === 'string'
      ? clip(error.message, MESSAGE_LIMIT)
      : clip(JSON.stringify(error));
  const failure: StreamFailure = { message };
  for (const value of [error.code, error.status]) {
    const status = typeof value === 'string' && /^\d{3}$/.test(value) ? Number(value) : value;
    if (typeof status === 'number' && Number.isInteger(status)) failure.status = status;
  }
  const type = [error.type, error.code].find(
    (value): value is string => typeof value === 'string' && !/^\d+$/.test(value),
  );
  if (type !== undefined) failure.type = type;
  return failure;
}

/** As long as an error body's message may be (`describeErrorBody`). */
const MESSAGE_LIMIT = 300;

function clip(text: string, limit = 200): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
