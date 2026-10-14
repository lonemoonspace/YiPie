import { describe, expect, it, vi } from 'vitest';
import { ModelConfig } from '@/contract/model-config';
import { streamChat, type ChatOptions } from '@/platform/llm/client';

const config = ModelConfig.parse({
  id: 'm',
  baseURL: 'http://localhost:11434/v1',
  apiKey: 'sk-secret-key',
  model: 'test-model',
});

const encoder = new TextEncoder();
const chunk = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

/** A response whose body delivers `parts` (text or raw bytes), `gap` ms apart. */
function streamResponse(parts: (string | Uint8Array)[], gap = 0, init: ResponseInit = {}) {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (gap > 0) await new Promise((resolve) => setTimeout(resolve, gap));
      const part = parts[index++];
      if (part === undefined) controller.close();
      else controller.enqueue(typeof part === 'string' ? encoder.encode(part) : part);
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
    ...init,
  });
}

/** A fetch that answers with `respond`, honouring the abort signal like the real one. */
function fakeFetch(respond: () => Response | Promise<Response>) {
  return vi.fn((_url: string | URL | Request, init?: RequestInit) => {
    const signal = init?.signal;
    return new Promise<Response>((resolve, reject) => {
      signal?.addEventListener('abort', () =>
        reject(new DOMException('The operation was aborted.', 'AbortError')),
      );
      Promise.resolve(respond()).then(resolve, reject);
    });
  });
}

async function run(options: Partial<ChatOptions> & Pick<ChatOptions, 'fetch'>) {
  const texts: string[] = [];
  const outcome = await streamChat({
    config,
    messages: [{ role: 'user', content: 'hi' }],
    signal: new AbortController().signal,
    onText: (text) => texts.push(text),
    hasAccess: () => Promise.resolve(true),
    ...options,
  });
  return { outcome, text: texts.join('') };
}

describe('streamChat', () => {
  it('streams the answer and finishes at [DONE]', async () => {
    const fetch = fakeFetch(() =>
      streamResponse([chunk('你好，'), chunk('世界'), 'data: [DONE]\n\n', chunk('ignored')]),
    );

    const { outcome, text } = await run({ fetch });

    expect(text).toBe('你好，世界');
    expect(outcome).toEqual({ kind: 'done', usage: null });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  });

  it('reassembles a character split across network chunks', async () => {
    const bytes = encoder.encode(chunk('你好'));
    const cut = bytes.indexOf(0xe4) + 1; // inside the three bytes of 你
    const fetch = fakeFetch(() =>
      streamResponse([bytes.slice(0, cut), bytes.slice(cut), 'data: [DONE]\n\n']),
    );

    expect((await run({ fetch })).text).toBe('你好');
  });

  it('ignores comment lines, which also keep a slow stream alive', async () => {
    const fetch = fakeFetch(() =>
      streamResponse(
        [
          ': processing\n\n',
          ': processing\n\n',
          ': processing\n\n',
          chunk('ok'),
          'data: [DONE]\n\n',
        ],
        30,
      ),
    );

    const { outcome, text } = await run({ fetch, idleTimeout: 60 });

    expect(text).toBe('ok');
    expect(outcome.kind).toBe('done');
  });

  it('reads usage from the end of the stream', async () => {
    const usage = { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 };
    const fetch = fakeFetch(() =>
      streamResponse([
        chunk('a'),
        `data: ${JSON.stringify({ choices: [], usage })}\n\n`,
        'data: [DONE]\n\n',
      ]),
    );

    expect((await run({ fetch })).outcome).toEqual({
      kind: 'done',
      usage: { promptTokens: 12, completionTokens: 3, totalTokens: 15 },
    });
  });

  it('treats a stream that ends without [DONE] as finished', async () => {
    const fetch = fakeFetch(() => streamResponse([chunk('a'), chunk('b')]));
    expect(await run({ fetch })).toEqual({ outcome: { kind: 'done', usage: null }, text: 'ab' });
  });

  it('keeps what arrived before an error inside the stream', async () => {
    const fetch = fakeFetch(() =>
      streamResponse([chunk('部分'), `data: {"error":{"message":"Upstream overloaded"}}\n\n`]),
    );

    expect(await run({ fetch })).toEqual({
      outcome: { kind: 'error', error: { kind: 'stream', detail: 'Upstream overloaded' } },
      text: '部分',
    });
  });

  it('explains an HTTP error with the service message, never the key', async () => {
    const fetch = fakeFetch(
      () =>
        new Response(
          JSON.stringify({ error: { message: 'Incorrect API key provided: sk-secret-key' } }),
          { status: 401 },
        ),
    );

    expect((await run({ fetch })).outcome).toEqual({
      kind: 'error',
      error: { kind: 'auth', status: 401, detail: 'Incorrect API key provided: ***' },
    });
  });

  it('blames a missing host permission when the browser blocks the request', async () => {
    const fetch = fakeFetch(() => Promise.reject(new TypeError('Failed to fetch')));

    expect((await run({ fetch, hasAccess: () => Promise.resolve(false) })).outcome).toMatchObject({
      kind: 'error',
      error: { kind: 'unauthorized-access' },
    });
    expect((await run({ fetch })).outcome).toMatchObject({
      kind: 'error',
      error: { kind: 'network', detail: 'Failed to fetch' },
    });
  });

  it('stops when the user asks, keeping what arrived', async () => {
    const user = new AbortController();
    const fetch = fakeFetch(() =>
      streamResponse([chunk('一'), chunk('二'), chunk('三'), chunk('四')], 40),
    );
    const texts: string[] = [];

    const outcome = await streamChat({
      config,
      messages: [],
      signal: user.signal,
      fetch,
      onText: (text) => {
        texts.push(text);
        if (texts.length === 2) user.abort();
      },
    });

    expect(outcome).toEqual({ kind: 'stopped' });
    expect(texts.join('')).toBe('一二');
  });

  it('gives up when the response does not start in time', async () => {
    const fetch = fakeFetch(() => new Promise<Response>(() => undefined));
    expect((await run({ fetch, firstByteTimeout: 30 })).outcome).toEqual({
      kind: 'error',
      error: { kind: 'timeout', detail: '' },
    });
  });

  it('gives up when the stream goes silent, keeping what arrived', async () => {
    const fetch = fakeFetch(() => streamResponse([chunk('开头')], 0, {}));
    const stalled = fakeFetch(() => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(chunk('开头')));
        },
      });
      return new Response(body, { status: 200 });
    });

    expect((await run({ fetch })).outcome.kind).toBe('done');
    expect(await run({ fetch: stalled, idleTimeout: 40 })).toEqual({
      outcome: { kind: 'error', error: { kind: 'timeout', detail: '' } },
      text: '开头',
    });
  });
});
