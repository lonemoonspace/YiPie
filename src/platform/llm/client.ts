import { EventSourceParserStream } from 'eventsource-parser/stream';
import type { ModelConfig } from '@/contract/model-config';
import {
  fromFetchFailure,
  fromHttpStatus,
  fromStreamError,
  redact,
  type LlmError,
} from '@/domain/llm/errors';
import { buildChatRequest, requestSecrets, type ChatMessage } from '@/domain/llm/request';
import { interpretEventData, type Usage } from '@/domain/llm/stream';
import { hasOriginAccess } from '@/platform/permissions/origin-access';

export type ChatOutcome =
  { kind: 'done'; usage: Usage | null } | { kind: 'stopped' } | { kind: 'error'; error: LlmError };

export interface ChatOptions {
  config: ModelConfig;
  messages: readonly ChatMessage[];
  /** The user's stop button. Text received so far has already been delivered. */
  signal: AbortSignal;
  /** Called with each piece of the answer as it arrives. */
  onText: (text: string) => void;
  /** How long the response may take to start (ms). Local models can be slow to load. */
  firstByteTimeout?: number;
  /** How long the stream may stay silent once it has started (ms). */
  idleTimeout?: number;
  fetch?: typeof fetch;
  /** Whether we hold the host permission; decides how a failed fetch is explained. */
  hasAccess?: (baseURL: string) => Promise<boolean>;
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
 * Never throws: every way it can end is an outcome. There is no automatic
 * retry in phase 1.
 */
export async function streamChat(options: ChatOptions): Promise<ChatOutcome> {
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
    const hasOriginPermission = timedOut
      ? null
      : await (options.hasAccess ?? hasOriginAccess)(config.baseURL).catch(() => null);
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
      const body = await readLimited(response, ERROR_BODY_LIMIT);
      return clean(fromHttpStatus(response.status, body));
    }
    if (response.body === null) return clean(fromStreamError('The response has no body.'));

    const idle = options.idleTimeout ?? DEFAULT_IDLE_TIMEOUT;
    watch(idle);
    // Any bytes count as life, SSE comments and heartbeats included. The
    // streaming decoder keeps a character split across chunks in one piece.
    const decoder = new TextDecoder();
    const decode = new TransformStream<Uint8Array<ArrayBuffer>, string>({
      transform(chunk, sink) {
        watch(idle);
        sink.enqueue(decoder.decode(chunk, { stream: true }));
      },
      flush(sink) {
        const rest = decoder.decode();
        if (rest !== '') sink.enqueue(rest);
      },
    });
    const reader = response.body
      .pipeThrough(decode)
      .pipeThrough(new EventSourceParserStream({ onError: 'terminate' }))
      .getReader();
    // Aborting `fetch` should error the body too; racing the signal makes a
    // stop or a timeout take effect even where a body does not cooperate.
    const aborted = new Promise<never>((_, reject) => {
      const fail = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
      if (controller.signal.aborted) fail();
      else controller.signal.addEventListener('abort', fail, { once: true });
    });
    aborted.catch(() => undefined);

    let usage: Usage | null = null;
    try {
      for (;;) {
        const { done, value } = await Promise.race([reader.read(), aborted]);
        if (done) return { kind: 'done', usage };
        for (const event of interpretEventData(value.data)) {
          if (event.type === 'content') options.onText(event.text);
          else if (event.type === 'usage') usage = event.usage;
          else if (event.type === 'error') return clean(fromStreamError(event.message));
          else return { kind: 'done', usage };
        }
      }
    } catch (error) {
      return await failed(error);
    } finally {
      // Ends the connection when we stop early ([DONE] seen, error, stop).
      void reader.cancel().catch(() => undefined);
    }
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', stop);
  }
}

async function readLimited(response: Response, limit: number): Promise<string> {
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  try {
    while (size < limit) {
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
