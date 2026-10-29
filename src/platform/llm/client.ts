import { EventSourceParserStream, ParseError } from 'eventsource-parser/stream';
import type { ModelConfig } from '@/contract/model-config';
import {
  automaticRetryWait,
  describeErrorBody,
  fromFetchFailure,
  fromHttpStatus,
  fromProtocolError,
  fromStreamError,
  redact,
  type LlmError,
} from '@/domain/llm/errors';
import { buildModelsRequest, isModelListUnsupported, parseModelList } from '@/domain/llm/models';
import { buildChatRequest, requestSecrets, type ChatMessage } from '@/domain/llm/request';
import {
  createThinkSplitter,
  interpretEventData,
  type Sorted,
  type Usage,
} from '@/domain/llm/stream';
import { hasOriginAccess } from '@/platform/permissions/origin-access';

/**
 * How a finished answer ended, when not as a whole: cut at the token limit
 * (`finish_reason: length`), or the stream closed without `[DONE]` and
 * without a finish reason, so it may have been cut off (#28).
 */
export type ChatEnding = 'length' | 'cut-off';

export type ChatOutcome =
  | { kind: 'done'; usage: Usage | null; ending?: ChatEnding }
  | { kind: 'stopped' }
  | { kind: 'error'; error: LlmError };

/** The parts of a model configuration a request uses. */
export type ChatConfig = Pick<
  ModelConfig,
  'baseURL' | 'apiKey' | 'model' | 'headers' | 'extraBody' | 'streamUsage'
>;

export interface ChatOptions {
  config: ChatConfig;
  messages: readonly ChatMessage[];
  /** The user's stop button. Text received so far has already been delivered. */
  signal: AbortSignal;
  /** Called with each piece of the answer as it arrives. */
  onText: (text: string) => void;
  /** Called with each piece of the model's reasoning, which is not the answer (appendix D). */
  onReasoning?: (text: string) => void;
  /**
   * The request failed before anything arrived, in a way worth one more try
   * (§4.5, decision 1): the client waits `seconds`, then sends it again.
   */
  onRetry?: (retry: { error: LlmError; seconds: number }) => void;
  /**
   * The service refused `stream_options`, then took the request without it:
   * the configuration should stop asking for usage (§4.5, decision 2).
   */
  onStreamOptionsRejected?: () => void;
  /** How long the response may take to start (ms). Local models can be slow to load. */
  firstByteTimeout?: number;
  /** How long the stream may stay silent once it has started (ms). */
  idleTimeout?: number;
  fetch?: typeof fetch;
  /** Whether we hold the host permission; decides how a failed fetch is explained. */
  hasAccess?: (baseURL: string) => Promise<boolean>;
  /** Waits before the retry, or less once `signal` aborts. Tests replace it. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export const DEFAULT_FIRST_BYTE_TIMEOUT = 120_000;
export const DEFAULT_IDLE_TIMEOUT = 60_000;
/** Error bodies are read up to this many bytes; the rest is not worth showing. */
const ERROR_BODY_LIMIT = 64 * 1024;

/**
 * Streams one chat completion from an OpenAI-compatible service (D2 in
 * docs/development-plan.md: our own client rather than an SDK). Runs in the
 * panel, never in the service worker (D4).
 *
 * Never throws: every way it can end is an outcome. Before anything has
 * arrived, it sends the request once more after a rate limit, a server error
 * or a network failure, and once without `stream_options` when the service
 * refuses that field (§4.5, decisions 1 and 2). Once text has been shown, a
 * failure ends the answer there.
 */
export async function streamChat(options: ChatOptions): Promise<ChatOutcome> {
  let config = options.config;
  let retried = false;
  let downgraded = false;
  for (;;) {
    let started = false;
    const outcome = await attempt({
      ...options,
      config,
      onText: (text) => {
        started = true;
        options.onText(text);
      },
      onReasoning: (text) => {
        started = true;
        options.onReasoning?.(text);
      },
      onAccepted: () => {
        if (downgraded) options.onStreamOptionsRejected?.();
      },
    });
    if (outcome.kind !== 'error' || started) return outcome;

    const { error } = outcome;
    // `stream_options` the user put in the extra body is theirs: without ours
    // the request would go out the same, and be refused the same.
    const ours = config.streamUsage && !Object.hasOwn(config.extraBody, 'stream_options');
    if (error.streamOptionsRejected === true && ours && !downgraded) {
      downgraded = true;
      config = { ...config, streamUsage: false };
      continue;
    }
    const seconds = retried ? null : automaticRetryWait(error);
    if (seconds === null) return outcome;
    retried = true;
    options.onRetry?.({ error, seconds });
    // Stopped during the wait, the next attempt ends before it starts.
    await (options.sleep ?? sleep)(seconds * 1000, options.signal);
  }
}

/** One request, as `streamChat` describes; `onAccepted` hears of a 2xx answer. */
async function attempt(options: ChatOptions & { onAccepted: () => void }): Promise<ChatOutcome> {
  const { config, signal } = options;
  if (signal.aborted) return { kind: 'stopped' };

  const request = buildChatRequest(config, options.messages);
  const secrets = requestSecrets(config);
  const controller = new AbortController();
  const stop = () => controller.abort();
  signal.addEventListener('abort', stop, { once: true });

  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watch = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, ms);
  };
  const clean = (error: LlmError): ChatOutcome => ({
    kind: 'error',
    error: { ...error, detail: redact(error.detail, secrets) },
  });
  const failed = async (error: unknown): Promise<ChatOutcome> => {
    if (signal.aborted) return { kind: 'stopped' };
    const hasOriginPermission = timedOut ? null : await accessTo(config.baseURL, options.hasAccess);
    return clean(
      fromFetchFailure({
        aborted: false,
        timedOut,
        hasOriginPermission,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  };

  try {
    watch(options.firstByteTimeout ?? DEFAULT_FIRST_BYTE_TIMEOUT);
    let response: Response;
    try {
      response = await (options.fetch ?? fetch)(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: controller.signal,
        // The key travels in a header; cookies and the referrer have no business here.
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
      });
    } catch (error) {
      return await failed(error);
    }

    if (!response.ok) {
      const body = await readLimited(response, ERROR_BODY_LIMIT, controller.signal);
      // Stopped while the body was read: not an error, and not retried.
      if (signal.aborted) return { kind: 'stopped' };
      // Classified by the body as sent; the detail shown is cut to length
      // from the body without credentials, so none is cut in half.
      const error = fromHttpStatus(response.status, body, response.headers.get('Retry-After'));
      return clean({ ...error, detail: describeErrorBody(redact(body, secrets)) });
    }
    options.onAccepted();
    if (response.body === null) return clean(fromProtocolError('The response has no body.'));

    // The first-byte timer runs on until the body's first bytes: many servers
    // send the headers at once and the first token only after reading the
    // prompt or loading the model (appendix D). From then on, any bytes count
    // as life, SSE comments and heartbeats included. The streaming decoder
    // keeps a character split across chunks in one piece.
    const idle = options.idleTimeout ?? DEFAULT_IDLE_TIMEOUT;
    const decoder = new TextDecoder();
    // The start of the body, for one that turns out not to be SSE at all.
    let head = '';
    const keep = (text: string) => {
      if (head.length < ERROR_BODY_LIMIT) head += text.slice(0, ERROR_BODY_LIMIT - head.length);
    };
    const decode = new TransformStream<Uint8Array<ArrayBuffer>, string>({
      transform(chunk, sink) {
        watch(idle);
        const text = decoder.decode(chunk, { stream: true });
        keep(text);
        sink.enqueue(text);
      },
      flush(sink) {
        const rest = decoder.decode();
        keep(rest);
        if (rest !== '') sink.enqueue(rest);
      },
    });
    // A line that is no SSE field (a vendor's `x-request-id:`, a blank
    // keep-alive) is skipped, as the SSE spec says, rather than ending the
    // stream as a network failure (#21). A body with nothing but such lines
    // is told apart at its end.
    const reader = response.body
      .pipeThrough(decode)
      .pipeThrough(new EventSourceParserStream({ onError: () => undefined }))
      .getReader();
    let events = 0;
    let usage: Usage | null = null;
    let reason: string | null = null;
    const finished = (complete: boolean): ChatOutcome => {
      const ending: ChatEnding | null =
        reason === 'length' ? 'length' : complete || reason !== null ? null : 'cut-off';
      return ending === null ? { kind: 'done', usage } : { kind: 'done', usage, ending };
    };
    /**
     * The stream ended without one event. Nothing but comments is an empty
     * answer; anything else (an HTML error page, a bare JSON error behind a
     * 200) is the service's words, shown as they are and not retried.
     */
    const ended = (): ChatOutcome => {
      const stray = head
        .split(/\r\n|\r|\n/)
        .some((line) => line.trim() !== '' && !line.startsWith(':'));
      if (events > 0) return finished(false);
      if (!stray) return { kind: 'done', usage };
      const detail = describeErrorBody(redact(head, secrets));
      return clean(fromProtocolError(`The service did not send a stream: ${detail}`));
    };
    // Aborting `fetch` should error the body too; racing the signal makes a
    // stop or a timeout take effect even where a body does not cooperate.
    const aborted = new Promise<never>((_, reject) => {
      const fail = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
      if (controller.signal.aborted) fail();
      else controller.signal.addEventListener('abort', fail, { once: true });
    });
    aborted.catch(() => undefined);

    // Reasoning written inline (`<think>…</think>`) is sorted out as it comes.
    const think = createThinkSplitter();
    const deliver = ({ reasoning, answer }: Sorted) => {
      if (reasoning !== '') options.onReasoning?.(reasoning);
      if (answer !== '') options.onText(answer);
    };
    try {
      for (;;) {
        const { done, value } = await Promise.race([reader.read(), aborted]);
        if (done) return ended();
        events += 1;
        let interpreted = interpretEventData(value.data, value.event);
        // A failure's words are cut to length: credentials go first, so none
        // is cut in half (#28).
        if (interpreted.some((event) => event.type === 'error' || event.type === 'invalid')) {
          interpreted = interpretEventData(redact(value.data, secrets), value.event);
        }
        for (const event of interpreted) {
          if (event.type === 'content') deliver(think.push(event.text));
          else if (event.type === 'reasoning') options.onReasoning?.(event.text);
          else if (event.type === 'usage') usage = event.usage;
          else if (event.type === 'finish') reason = event.reason;
          else if (event.type === 'error') return clean(fromStreamError(event.failure));
          else if (event.type === 'invalid') return clean(fromProtocolError(event.message));
          else return finished(true);
        }
      }
    } catch (error) {
      // Our own parser gave up (an endless line): the data is at fault, not the network.
      if (!signal.aborted && error instanceof ParseError) {
        return clean(fromProtocolError(error.message));
      }
      return await failed(error);
    } finally {
      // What the splitter still holds arrived too, however the stream ended.
      deliver(think.flush());
      // Ends the connection when we stop early ([DONE] seen, error, stop).
      void reader.cancel().catch(() => undefined);
    }
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', stop);
  }
}

export type ModelListOutcome =
  /** The service listed its models. */
  | { kind: 'listed'; models: string[] }
  /** The service has no model list (or answered with something else). */
  | { kind: 'unsupported'; status: number }
  | { kind: 'error'; error: LlmError };

export interface ModelListOptions {
  config: Pick<ModelConfig, 'baseURL' | 'apiKey' | 'headers'>;
  signal?: AbortSignal;
  /** How long the answer may take (ms). */
  timeout?: number;
  fetch?: typeof fetch;
  hasAccess?: (baseURL: string) => Promise<boolean>;
}

export const DEFAULT_MODEL_LIST_TIMEOUT = 15_000;
const MODEL_LIST_BODY_LIMIT = 16 * 1024 * 1024;

/**
 * Reads the service's model list (`GET {baseURL}/models`): the settings
 * page's connection test, which spends no tokens (docs/development-plan.md
 * §4.6). Never throws. Error details are redacted like a chat request's.
 */
export async function listModels(options: ModelListOptions): Promise<ModelListOutcome> {
  const { config } = options;
  const request = buildModelsRequest(config);
  const secrets = requestSecrets(config);
  const clean = (error: LlmError): ModelListOutcome => ({
    kind: 'error',
    error: { ...error, detail: redact(error.detail, secrets) },
  });
  // Cancelled before it began (the test was started again, or its page
  // left): no request at all. A listener added now would never fire.
  if (options.signal?.aborted === true) {
    return clean(
      fromFetchFailure({ aborted: true, timedOut: false, hasOriginPermission: null, message: '' }),
    );
  }
  const controller = new AbortController();
  let cancelled = false;
  const stop = () => {
    cancelled = true;
    controller.abort();
  };
  options.signal?.addEventListener('abort', stop, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeout ?? DEFAULT_MODEL_LIST_TIMEOUT);
  // Ended by the timeout or the caller, during the request or its body.
  const ended = () =>
    clean(
      fromFetchFailure({
        aborted: cancelled,
        timedOut,
        hasOriginPermission: null,
        message: '',
      }),
    );
  const abortedWhile = new Promise<null>((resolve) =>
    controller.signal.addEventListener('abort', () => resolve(null), { once: true }),
  );

  try {
    let response: Response;
    try {
      response = await (options.fetch ?? fetch)(request.url, {
        headers: request.headers,
        signal: controller.signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
      });
    } catch (error) {
      const aborted = cancelled;
      const hasOriginPermission =
        aborted || timedOut ? null : await accessTo(config.baseURL, options.hasAccess);
      return clean(
        fromFetchFailure({
          aborted,
          timedOut,
          hasOriginPermission,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    // Some lists are large (OpenRouter's runs to megabytes); an error is not.
    // `readLimited` keeps what arrived when the body breaks off, so a body cut
    // short by the timeout must not be read as a list, or as no list: the
    // race also covers a body that ignores the abort.
    const body = await Promise.race([
      readLimited(
        response,
        response.ok ? MODEL_LIST_BODY_LIMIT : ERROR_BODY_LIMIT,
        controller.signal,
      ),
      abortedWhile,
    ]);
    if (body === null || controller.signal.aborted) return ended();
    if (isModelListUnsupported(response.status)) {
      return { kind: 'unsupported', status: response.status };
    }
    if (!response.ok) return clean(fromHttpStatus(response.status, body));
    const models = parseModelList(body);
    return models === null
      ? { kind: 'unsupported', status: response.status }
      : { kind: 'listed', models };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', stop);
  }
}

/** Waits `ms`, or until `signal` aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
    if (signal.aborted) done();
  });
}

/**
 * Whether we hold the host permission for `baseURL`, or null when that cannot
 * be told: the probe may throw before it returns a promise.
 */
async function accessTo(
  baseURL: string,
  hasAccess: (baseURL: string) => Promise<boolean> = hasOriginAccess,
): Promise<boolean | null> {
  try {
    return await hasAccess(baseURL);
  } catch {
    return null;
  }
}

/** The body as text, up to `limit` bytes; stops reading once `signal` aborts. */
async function readLimited(
  response: Response,
  limit: number,
  signal?: AbortSignal,
): Promise<string> {
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  try {
    while (size < limit && signal?.aborted !== true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    // Show what arrived before the body broke off.
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  return text;
}
