import { isLocalOrigin } from '@/domain/url';

/**
 * Error classification (docs/development-plan.md §4.5): what went wrong, in
 * terms of what the user can do about it.
 */
export type LlmErrorKind =
  /** 401 / 403: the key is missing, wrong or not allowed to use the model. */
  | 'auth'
  /** The browser blocked the request: no host permission for this origin. */
  | 'unauthorized-access'
  /** Too many requests for now (429). */
  | 'rate-limit'
  /** Out of balance, credits or quota (402, or a 429 that says so). */
  | 'quota'
  /** The request is longer than the model's context window. */
  | 'context-length'
  /** The service refused the request as invalid (400 / 422). */
  | 'bad-request'
  /** No such model, or no chat completions at this base URL (404). */
  | 'not-found'
  /** The service failed (5xx), or reported a failure inside the stream. */
  | 'server'
  /** Nothing arrived for too long, before the first byte or mid-stream. */
  | 'timeout'
  /** The service could not be reached. */
  | 'network'
  /** The user stopped the request. */
  | 'aborted'
  /** Anything else: another status, or data that breaks the protocol. */
  | 'unknown';

export interface LlmError {
  kind: LlmErrorKind;
  /** The HTTP status, or the code a failure inside the stream carried. */
  status?: number;
  /**
   * Detail from the service or the browser, for display. The client redacts
   * every credential of the configuration from it (`requestSecrets`).
   */
  detail: string;
  /** Seconds the service asked to wait before trying again (`Retry-After`). */
  retryAfter?: number;
  /** The service does not know `stream_options` (§4.5, decision 2). */
  streamOptionsRejected?: boolean;
}

/**
 * How services say a request does not fit the model's context window: OpenAI
 * and most compatibles (`context_length_exceeded`, "maximum context length is
 * … tokens"), vLLM and OpenRouter (the same words), gateways in front of
 * Anthropic models ("prompt is too long"), Gemini ("exceeds the maximum
 * number of tokens"). A local server such as Ollama may instead cut the
 * input without a word (docs/development-plan.md appendix D).
 */
const CONTEXT_LENGTH =
  /context[ _-]?length|context window|maximum context|prompt is too long|input is too long|exceeds the maximum number of tokens/i;

/**
 * Out of money rather than too fast: OpenAI's `insufficient_quota` (a 429),
 * DeepSeek's "Insufficient Balance" (402), OpenRouter's credits, Gemini's
 * "exceeded your current quota". Waiting does not help, so it is not retried.
 */
const QUOTA = /quota|balance|credit|billing/i;

/** A refusal that names `stream_options` (appendix D). */
const STREAM_OPTIONS = /stream_options|include_usage/i;

/** How a failure inside a stream names its kind when it carries no status. */
const STREAM_KINDS: [RegExp, LlmErrorKind][] = [
  [CONTEXT_LENGTH, 'context-length'],
  [/insufficient_quota|quota|balance|credit/i, 'quota'],
  [/rate[ _-]?limit|too many requests/i, 'rate-limit'],
  [/invalid[ _-]?request/i, 'bad-request'],
  [/authenticat|unauthori[sz]ed|api[ _-]?key/i, 'auth'],
];

function kindOfStatus(status: number, text: string): LlmErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 402 || (status === 429 && QUOTA.test(text))) return 'quota';
  if (status === 429) return 'rate-limit';
  // Too large for the gateway or for the model: either way, the page must be cut.
  if (status === 413 || ((status === 400 || status === 422) && CONTEXT_LENGTH.test(text))) {
    return 'context-length';
  }
  if (status === 404) return 'not-found';
  if (status === 400 || status === 422) return 'bad-request';
  if (status === 408) return 'timeout';
  if (status >= 500 && status <= 599) return 'server';
  return 'unknown';
}

/** Classifies a non-2xx answer; `retryAfter` is its `Retry-After` header. */
export function fromHttpStatus(
  status: number,
  body: string,
  retryAfter: string | null = null,
  now: number = Date.now(),
): LlmError {
  const error: LlmError = {
    kind: kindOfStatus(status, body),
    status,
    detail: describeErrorBody(body),
  };
  const wait = parseRetryAfter(retryAfter, now);
  if (wait !== null) error.retryAfter = wait;
  if ((status === 400 || status === 422) && STREAM_OPTIONS.test(body)) {
    error.streamOptionsRejected = true;
  }
  return error;
}

/** What a failure reported inside a 200 stream said about itself. */
export interface StreamFailure {
  message: string;
  /** A numeric `code` or `status`, as aggregators such as OpenRouter send. */
  status?: number;
  /** Its `type` or string `code`, such as `rate_limit_exceeded`. */
  type?: string;
}

/**
 * Classifies a failure the service reported inside the stream (appendix D).
 * One that carries an HTTP-like code goes by it; otherwise its words decide,
 * and a failure that names nothing is the service's.
 */
export function fromStreamError({ message, status, type }: StreamFailure): LlmError {
  const text = `${type ?? ''} ${message}`;
  if (status !== undefined && status >= 400 && status <= 599) {
    return { kind: kindOfStatus(status, text), status, detail: message };
  }
  const kind = STREAM_KINDS.find(([pattern]) => pattern.test(text))?.[1] ?? 'server';
  return { kind, detail: message };
}

/** Data that breaks the protocol: not JSON, not an object, no body at all. */
export function fromProtocolError(message: string): LlmError {
  return { kind: 'unknown', detail: message };
}

/**
 * `Retry-After` in seconds: a number of seconds, or a date. Null when absent
 * or unreadable.
 */
export function parseRetryAfter(value: string | null, now: number): number | null {
  const text = value?.trim() ?? '';
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
  // A date is written out ("Wed, 21 Oct 2015 07:28:00 GMT"); `Date.parse`
  // alone would take "-3" for a year.
  const at = /[a-z]/i.test(text) ? Date.parse(text) : Number.NaN;
  return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - now) / 1000));
}

/** The longest wait before the automatic retry (§4.5, decision 1), in seconds. */
export const MAX_RETRY_WAIT = 10;
/** The wait when the service does not say how long, in seconds. */
export const DEFAULT_RETRY_WAIT = 2;

/**
 * Seconds to wait before retrying on our own, or null when this error is not
 * retried (§4.5, decision 1). Rate limits, server errors and network failures
 * are, once, and only before anything arrived (the caller knows that); a wait
 * longer than 10 s is the service saying "not now", so it is left to the user.
 */
export function automaticRetryWait(error: LlmError): number | null {
  if (error.kind !== 'rate-limit' && error.kind !== 'server' && error.kind !== 'network') {
    return null;
  }
  const wait = error.retryAfter ?? DEFAULT_RETRY_WAIT;
  return wait <= MAX_RETRY_WAIT ? wait : null;
}

/** What the panel offers after an error. */
export interface ErrorAdvice {
  /** Trying again by hand may help. */
  retry: boolean;
  /** The fix is likely in the model's settings. */
  settings: boolean;
}

const ADVICE: Record<LlmErrorKind, ErrorAdvice> = {
  auth: { retry: false, settings: true },
  'unauthorized-access': { retry: false, settings: true },
  'rate-limit': { retry: true, settings: false },
  quota: { retry: true, settings: false },
  'context-length': { retry: false, settings: true },
  'bad-request': { retry: false, settings: true },
  'not-found': { retry: false, settings: true },
  server: { retry: true, settings: false },
  timeout: { retry: true, settings: false },
  network: { retry: true, settings: true },
  aborted: { retry: false, settings: false },
  unknown: { retry: true, settings: false },
};

export function adviceFor(kind: LlmErrorKind): ErrorAdvice {
  return ADVICE[kind];
}

/**
 * A local service refused us with 403: almost always Ollama, which turns
 * away requests from extensions until `OLLAMA_ORIGINS` allows them
 * (appendix D).
 */
export function isLocalOriginRefusal(error: LlmError, origin: string): boolean {
  return error.kind === 'auth' && error.status === 403 && isLocalOrigin(origin);
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

/**
 * Secrets at least this long are replaced wherever they occur. A shorter one,
 * such as a placeholder key like `x` or a header value like `1`, is replaced
 * wherever it stands alone, with no ASCII letter or digit on either side: that
 * is how an echoed credential appears, and replacing it inside other words
 * would garble the message without hiding anything more.
 */
const SUBSTRING_SECRET_LENGTH = 8;

/**
 * Replaces each secret that occurs in `text`, so no message shows a
 * credential. Every non-empty secret counts, however short.
 */
export function redact(text: string, secrets: readonly string[]): string {
  // Longest first, so a secret that contains another is replaced whole.
  const distinct = [...new Set(secrets.filter((secret) => secret !== ''))].sort(
    (a, b) => b.length - a.length,
  );
  return distinct.reduce((result, secret) => {
    if (secret.length >= SUBSTRING_SECRET_LENGTH) return result.split(secret).join('***');
    const alone = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(secret)}(?![A-Za-z0-9])`, 'g');
    return result.replace(alone, '***');
  }, text);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
