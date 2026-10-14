export interface Usage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

export type StreamEvent =
  | { type: 'content'; text: string }
  | { type: 'usage'; usage: Usage }
  | { type: 'error'; message: string }
  | { type: 'done' };

/**
 * Turns the `data` of one server-sent event from a chat completions stream
 * into the events the panel cares about. The SSE framing (lines, comments,
 * events split across network chunks) is the parser's job; this function only
 * reads one payload.
 *
 * Reasoning fields (`delta.reasoning_content`, `delta.reasoning`) are ignored
 * here, so they never mix into the answer; phase 4 shows them separately.
 */
export function interpretEventData(data: string): StreamEvent[] {
  const payload = data.trim();
  if (payload === '') return [];
  if (payload === '[DONE]') return [{ type: 'done' }];

  let chunk: unknown;
  try {
    chunk = JSON.parse(payload);
  } catch {
    return [{ type: 'error', message: `The service sent data that is not JSON: ${clip(payload)}` }];
  }
  if (!isRecord(chunk)) {
    return [{ type: 'error', message: `The service sent unexpected data: ${clip(payload)}` }];
  }

  // Some aggregators report a failure inside a 200 stream.
  if (chunk.error !== undefined && chunk.error !== null) {
    return [{ type: 'error', message: errorMessage(chunk.error) }];
  }

  const events: StreamEvent[] = [];
  const text = firstChoiceContent(chunk.choices);
  if (text !== '') events.push({ type: 'content', text });

  // Usually its own final chunk with `choices: []`, but some servers attach
  // it to the last content chunk.
  const usage = readUsage(chunk.usage);
  if (usage) events.push({ type: 'usage', usage });

  return events;
}

function firstChoiceContent(choices: unknown): string {
  if (!Array.isArray(choices)) return '';
  const first: unknown = choices[0];
  if (!isRecord(first) || !isRecord(first.delta)) return '';
  return typeof first.delta.content === 'string' ? first.delta.content : '';
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

function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (isRecord(error) && typeof error.message === 'string') return error.message;
  return clip(JSON.stringify(error));
}

function clip(text: string, limit = 200): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
