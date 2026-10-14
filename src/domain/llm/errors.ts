/**
 * Error classification, version 0 (docs/development-plan.md §4.2). Phase 4
 * adds rate limits, quota, context length, bad requests and server errors as
 * their own kinds; until then they are `http` with the service's message.
 */
export type LlmErrorKind =
  /** 401 / 403: the key is missing, wrong or not allowed to use the model. */
  | 'auth'
  /** The browser blocked the request: no host permission for this origin. */
  | 'unauthorized-access'
  /** The service could not be reached. */
  | 'network'
  /** Nothing arrived for too long, before the first byte or mid-stream. */
  | 'timeout'
  /** Any other non-2xx answer. */
  | 'http'
  /** The service reported a failure inside the stream, or broke the protocol. */
  | 'stream'
  /** The user stopped the request. */
  | 'aborted'
  | 'unknown';

export interface LlmError {
  kind: LlmErrorKind;
  /** The HTTP status, when the service answered. */
  status?: number;
  /** Detail from the service or the browser, for display. Never contains the API key. */
  detail: string;
}

export function fromHttpStatus(status: number, body: string): LlmError {
  return {
    kind: status === 401 || status === 403 ? 'auth' : 'http',
    status,
    detail: describeErrorBody(body),
  };
}

export function fromStreamError(message: string): LlmError {
  return { kind: 'stream', detail: message };
}

export interface FetchFailure {
  /** The user aborted the request. */
  aborted: boolean;
  /** The idle watchdog aborted it. */
  timedOut: boolean;
  /** Whether we hold the host permission for the service; `null` when unknown. */
  hasOriginPermission: boolean | null;
  /** The browser's message, e.g. `Failed to fetch`. */
  message: string;
}

/**
 * Classifies a `fetch` that threw. Browsers report a CORS refusal and an
 * unreachable server with the same `TypeError`, so the permission state
 * decides: without it the likely cause is the missing permission.
 */
export function fromFetchFailure(failure: FetchFailure): LlmError {
  if (failure.aborted) return { kind: 'aborted', detail: '' };
  if (failure.timedOut) return { kind: 'timeout', detail: '' };
  if (failure.hasOriginPermission === false) {
    return { kind: 'unauthorized-access', detail: failure.message };
  }
  return { kind: 'network', detail: failure.message };
}

/**
 * The useful part of an error body: the message from the common JSON shapes,
 * the text of an HTML error page, or the start of plain text.
 */
export function describeErrorBody(body: string): string {
  const text = body.trim();
  if (text === '') return '';

  try {
    const parsed: unknown = JSON.parse(text);
    const message = findMessage(parsed);
    if (message !== null) return clip(message);
  } catch {
    // Not JSON; fall through.
  }

  if (text.startsWith('<')) {
    return clip(
      text
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    );
  }
  return clip(text);
}

/** Replaces each secret that occurs in `text`, so no message shows a key. */
export function redact(text: string, secrets: readonly string[]): string {
  return secrets
    .filter((secret) => secret.length >= 4)
    .reduce((result, secret) => result.split(secret).join('***'), text);
}

function findMessage(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  // {"error":{"message":…}} (OpenAI and most compatibles), {"error":"…"},
  // {"message":…}, {"detail":…} (FastAPI-based servers).
  for (const key of ['error', 'message', 'detail']) {
    const found = findMessage(record[key]);
    if (found !== null) return found;
  }
  return null;
}

function clip(text: string, limit = 300): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
