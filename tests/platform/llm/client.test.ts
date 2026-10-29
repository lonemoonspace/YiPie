import { describe, expect, it, vi } from 'vitest';
import { ModelConfig } from '@/contract/model-config';
import { listModels, streamChat, type ChatOptions } from '@/platform/llm/client';

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

/**
 * Runs one chat. Waits before a retry take no time unless a test passes its
 * own `sleep`; the retries are recorded.
 */
async function run(options: Partial<ChatOptions> & Pick<ChatOptions, 'fetch'>) {
  const texts: string[] = [];
  const retries: { kind: string; seconds: number }[] = [];
  const outcome = await streamChat({
    config,
    messages: [{ role: 'user', content: 'hi' }],
    signal: new AbortController().signal,
    onText: (text) => texts.push(text),
    onRetry: ({ error, seconds }) => retries.push({ kind: error.kind, seconds }),
    hasAccess: () => Promise.resolve(true),
    sleep: () => Promise.resolve(),
    ...options,
  });
  return { outcome, text: texts.join(''), retries };
}

/** A fetch that answers each call with the next of `responses` (the last one repeats). */
function answers(...responses: (() => Response | Promise<Response>)[]) {
  let call = 0;
  return fakeFetch(() => {
    const respond = responses[Math.min(call, responses.length - 1)];
    call += 1;
    if (respond === undefined) throw new Error('no response');
    return respond();
  });
}

/** The body request `call` sent, parsed. */
function sentBody(fetch: ReturnType<typeof fakeFetch>, call: number): Record<string, unknown> {
  const body = fetch.mock.calls[call]?.[1]?.body;
  return typeof body === 'string' ? (JSON.parse(body) as Record<string, unknown>) : {};
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

  it('finishes a stream that ends without [DONE], marked as possibly cut off (#28)', async () => {
    const fetch = fakeFetch(() => streamResponse([chunk('a'), chunk('b')]));
    expect((await run({ fetch })).outcome).toEqual({
      kind: 'done',
      usage: null,
      ending: 'cut-off',
    });
  });

  it('takes a finish reason for a whole answer, [DONE] or not, but marks the length limit (#28)', async () => {
    const finish = (reason: string) =>
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: reason }] })}\n\n`;

    const stopped = fakeFetch(() => streamResponse([chunk('a'), finish('stop')]));
    expect((await run({ fetch: stopped })).outcome).toEqual({ kind: 'done', usage: null });

    const long = fakeFetch(() =>
      streamResponse([chunk('a'), finish('length'), 'data: [DONE]\n\n']),
    );
    expect((await run({ fetch: long })).outcome).toEqual({
      kind: 'done',
      usage: null,
      ending: 'length',
    });
  });

  it('calls a failed request a network failure when the permission check itself fails (#28)', async () => {
    const fetch = fakeFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    const { outcome } = await run({
      fetch,
      hasAccess: () => Promise.reject(new Error('unavailable')),
    });
    expect(outcome).toMatchObject({ kind: 'error', error: { kind: 'network' } });
  });

  it('keeps what arrived before an error inside the stream', async () => {
    const fetch = fakeFetch(() =>
      streamResponse([chunk('部分'), `data: {"error":{"message":"Upstream overloaded"}}\n\n`]),
    );

    expect(await run({ fetch })).toMatchObject({
      outcome: { kind: 'error', error: { kind: 'server', detail: 'Upstream overloaded' } },
      text: '部分',
      // Once text has been shown, a failure ends the answer there.
      retries: [],
    });
    expect(fetch).toHaveBeenCalledOnce();
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

  it('keeps every credential of the configuration out of what it shows', async () => {
    const echoing = ModelConfig.parse({
      id: 'm',
      baseURL: 'https://gw.example/v1?key=query-secret-1',
      apiKey: 'abc',
      model: 'test-model',
      headers: { 'X-API-Key': 'header-secret-2', Authorization: 'Bearer override-secret-3' },
    });
    const echo = 'got key abc, X-API-Key header-secret-2, override-secret-3, ?key=query-secret-1';

    const http = await run({
      config: echoing,
      fetch: fakeFetch(() => new Response(JSON.stringify({ error: echo }), { status: 401 })),
    });
    const stream = await run({
      config: echoing,
      fetch: fakeFetch(() => streamResponse([`data: ${JSON.stringify({ error: echo })}\n\n`])),
    });

    for (const { outcome } of [http, stream]) {
      expect(outcome).toMatchObject({
        kind: 'error',
        error: { detail: 'got key ***, X-API-Key ***, ***, ?key=***' },
      });
    }
  });

  it('takes a key out before it cuts a long detail, so no part of it shows (#28)', async () => {
    const message = `${'x'.repeat(295)} sk-secret-key and more`;
    const http = await run({
      fetch: fakeFetch(() => new Response(JSON.stringify({ error: { message } }), { status: 400 })),
    });
    const stream = await run({
      fetch: fakeFetch(() =>
        streamResponse([`data: ${JSON.stringify({ error: { message } })}\n\n`]),
      ),
    });

    for (const { outcome } of [http, stream]) {
      expect(outcome.kind).toBe('error');
      const detail = outcome.kind === 'error' ? outcome.error.detail : '';
      expect(detail).not.toContain('sk-');
      expect(detail.length).toBeLessThanOrEqual(301);
    }
  });

  it('cuts a failure reported in the stream to length, however long (#28)', async () => {
    const message = 'y'.repeat(100_000);
    const { outcome } = await run({
      fetch: fakeFetch(() =>
        streamResponse([`data: ${JSON.stringify({ error: { message } })}\n\n`]),
      ),
    });

    expect(outcome.kind === 'error' && outcome.error.detail.length).toBe(301);
  });

  it('stops while an error body is read, without retrying (#28)', async () => {
    const user = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        user.abort();
        controller.enqueue(encoder.encode('busy'));
        controller.close();
      },
    });
    const fetch = fakeFetch(() => new Response(body, { status: 503 }));
    const result = await run({ fetch, signal: user.signal });

    expect(result.outcome).toEqual({ kind: 'stopped' });
    expect(result.retries).toEqual([]);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('blames a missing host permission when the browser blocks the request', async () => {
    const fetch = fakeFetch(() => Promise.reject(new TypeError('Failed to fetch')));

    expect((await run({ fetch, hasAccess: () => Promise.resolve(false) })).outcome).toMatchObject({
      kind: 'error',
      error: { kind: 'unauthorized-access' },
    });
    expect(fetch).toHaveBeenCalledOnce();
    // A network failure is tried once more, then reported.
    expect(await run({ fetch })).toMatchObject({
      outcome: { kind: 'error', error: { kind: 'network', detail: 'Failed to fetch' } },
      retries: [{ kind: 'network', seconds: 2 }],
    });
    expect(fetch).toHaveBeenCalledTimes(3);
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

  it('gives the body as long to start as the response: the first token can take a while', async () => {
    const silent = fakeFetch(() => new Response(new ReadableStream<Uint8Array>(), { status: 200 }));
    const late = fakeFetch(() => streamResponse([chunk('好'), 'data: [DONE]\n\n'], 60));

    expect(
      (await run({ fetch: silent, firstByteTimeout: 40, idleTimeout: 10_000 })).outcome,
    ).toEqual({ kind: 'error', error: { kind: 'timeout', detail: '' } });
    expect((await run({ fetch: late, firstByteTimeout: 1_000, idleTimeout: 30 })).outcome).toEqual({
      kind: 'error',
      error: { kind: 'timeout', detail: '' },
    });
    expect(
      (await run({ fetch: late, firstByteTimeout: 1_000, idleTimeout: 200 })).outcome.kind,
    ).toBe('done');
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
    expect(await run({ fetch: stalled, idleTimeout: 40 })).toMatchObject({
      outcome: { kind: 'error', error: { kind: 'timeout', detail: '' } },
      text: '开头',
    });
  });
});

describe('streamChat: the one automatic retry (§4.5, decision 1)', () => {
  const tooMany = (retryAfter?: string) => () =>
    new Response('{"error":{"message":"Rate limit reached"}}', {
      status: 429,
      headers: retryAfter === undefined ? {} : { 'Retry-After': retryAfter },
    });
  const ok = () => streamResponse([chunk('好'), 'data: [DONE]\n\n']);

  it('waits as long as a 429 asks, then succeeds on the second try', async () => {
    const fetch = answers(tooMany('3'), ok);
    const waits: number[] = [];

    const result = await run({
      fetch,
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });

    expect(result).toMatchObject({
      outcome: { kind: 'done' },
      text: '好',
      retries: [{ kind: 'rate-limit', seconds: 3 }],
    });
    expect(waits).toEqual([3000]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('tries only once more', async () => {
    const fetch = answers(tooMany(), tooMany());

    expect(await run({ fetch })).toMatchObject({
      outcome: { kind: 'error', error: { kind: 'rate-limit', status: 429 } },
      retries: [{ kind: 'rate-limit', seconds: 2 }],
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('leaves a wait over 10 s to the user', async () => {
    const fetch = answers(tooMany('30'), ok);

    expect(await run({ fetch })).toMatchObject({
      outcome: { kind: 'error', error: { kind: 'rate-limit', retryAfter: 30 } },
      retries: [],
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('tries a server error once more, also one reported in the stream before any text', async () => {
    const http = answers(() => new Response('Bad Gateway', { status: 502 }), ok);
    const inStream = answers(
      () => streamResponse([`data: {"error":{"code":503,"message":"overloaded"}}\n\n`]),
      ok,
    );

    for (const fetch of [http, inStream]) {
      expect(await run({ fetch })).toMatchObject({ outcome: { kind: 'done' }, text: '好' });
      expect(fetch).toHaveBeenCalledTimes(2);
    }
  });

  it.each([
    [401, '{"error":{"message":"bad key"}}'],
    [400, '{"error":{"message":"invalid model"}}'],
    [404, '{"error":{"message":"no such model"}}'],
    [402, '{"error":{"message":"Insufficient Balance"}}'],
    [400, '{"error":{"code":"context_length_exceeded","message":"maximum context length"}}'],
  ])('does not try a %i again', async (status, body) => {
    const fetch = answers(() => new Response(body, { status }), ok);

    expect((await run({ fetch })).outcome.kind).toBe('error');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('stops during the wait when the user asks, without sending again', async () => {
    const user = new AbortController();
    const fetch = answers(tooMany('5'), ok);

    const result = await run({
      fetch,
      signal: user.signal,
      onRetry: () => user.abort(),
      sleep: undefined,
    });

    expect(result.outcome).toEqual({ kind: 'stopped' });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('really waits when nobody replaces the wait', async () => {
    const fetch = answers(tooMany('0.05'), ok);
    const started = Date.now();

    expect((await run({ fetch, sleep: undefined })).outcome.kind).toBe('done');
    expect(Date.now() - started).toBeGreaterThanOrEqual(40);
  });
});

describe('streamChat: a service that refuses stream_options (§4.5, decision 2)', () => {
  const refused = () =>
    new Response('{"error":{"message":"Unrecognized request argument supplied: stream_options"}}', {
      status: 400,
    });
  const ok = () => streamResponse([chunk('好'), 'data: [DONE]\n\n']);

  it('sends the request again without it, and says so once the service takes it', async () => {
    const fetch = answers(refused, ok);
    const rejected = vi.fn();

    const result = await run({ fetch, onStreamOptionsRejected: rejected });

    expect(result).toMatchObject({ outcome: { kind: 'done' }, text: '好', retries: [] });
    expect(sentBody(fetch, 0)).toHaveProperty('stream_options', { include_usage: true });
    expect(sentBody(fetch, 1)).not.toHaveProperty('stream_options');
    expect(rejected).toHaveBeenCalledOnce();
  });

  it('says nothing when the service never refused it', async () => {
    const fetch = answers(ok);
    const rejected = vi.fn();

    expect((await run({ fetch, onStreamOptionsRejected: rejected })).outcome.kind).toBe('done');
    expect(sentBody(fetch, 0)).toHaveProperty('stream_options');
    expect(rejected).not.toHaveBeenCalled();
  });

  it('says nothing when the request fails without it too', async () => {
    const fetch = answers(refused, () => new Response('invalid model', { status: 400 }));
    const rejected = vi.fn();

    const result = await run({ fetch, onStreamOptionsRejected: rejected });

    expect(result.outcome).toMatchObject({ kind: 'error', error: { kind: 'bad-request' } });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(rejected).not.toHaveBeenCalled();
  });

  it('does not send the same request again when the extra body sets stream_options too (#28)', async () => {
    const fetch = answers(refused, ok);
    const rejected = vi.fn();

    const result = await run({
      config: { ...config, streamUsage: true, extraBody: { stream_options: { x: 1 } } },
      fetch,
      onStreamOptionsRejected: rejected,
    });

    expect(result.outcome).toMatchObject({ kind: 'error', error: { kind: 'bad-request' } });
    expect(fetch).toHaveBeenCalledOnce();
    expect(rejected).not.toHaveBeenCalled();
  });

  it('leaves alone stream_options the user put in the extra body', async () => {
    const fetch = answers(refused, ok);
    const rejected = vi.fn();

    const result = await run({
      config: { ...config, streamUsage: false, extraBody: { stream_options: { x: 1 } } },
      fetch,
      onStreamOptionsRejected: rejected,
    });

    expect(result.outcome).toMatchObject({ kind: 'error', error: { kind: 'bad-request' } });
    expect(fetch).toHaveBeenCalledOnce();
    expect(rejected).not.toHaveBeenCalled();
  });
});

describe('listModels', () => {
  const json =
    (body: unknown, status = 200) =>
    () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });

  it('reads the list with the key, from {baseURL}/models', async () => {
    const fetch = answers(json({ data: [{ id: 'gpt-test' }, { id: 'other' }] }));

    const outcome = await listModels({ config, fetch, hasAccess: () => Promise.resolve(true) });

    expect(outcome).toEqual({ kind: 'listed', models: ['gpt-test', 'other'] });
    expect(fetch.mock.calls[0]?.[0]).toBe('http://localhost:11434/v1/models');
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: `Bearer ${config.apiKey}`,
    });
  });

  it('says the service has no list on 404, or when the answer is no list', async () => {
    expect(await listModels({ config, fetch: answers(json({ error: 'x' }, 404)) })).toEqual({
      kind: 'unsupported',
      status: 404,
    });
    expect(
      await listModels({ config, fetch: answers(() => new Response('<html>hi</html>')) }),
    ).toEqual({ kind: 'unsupported', status: 200 });
  });

  it('classifies a refusal, with the key taken out of what the service said', async () => {
    const outcome = await listModels({
      config,
      fetch: answers(json({ error: { message: `bad key ${config.apiKey}` } }, 401)),
    });

    expect(outcome).toMatchObject({ kind: 'error', error: { kind: 'auth', status: 401 } });
    expect(JSON.stringify(outcome)).not.toContain(config.apiKey);
  });

  it('tells a blocked request from a network failure by the host permission', async () => {
    const failing = () => answers(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(
      await listModels({ config, fetch: failing(), hasAccess: () => Promise.resolve(false) }),
    ).toMatchObject({ kind: 'error', error: { kind: 'unauthorized-access' } });
    expect(
      await listModels({ config, fetch: failing(), hasAccess: () => Promise.resolve(true) }),
    ).toMatchObject({ kind: 'error', error: { kind: 'network' } });
  });

  it('still answers when the host permission cannot be asked', async () => {
    const outcome = await listModels({
      config,
      fetch: answers(() => Promise.reject(new TypeError('Failed to fetch'))),
      hasAccess: () => {
        throw new TypeError('Invalid URL');
      },
    });

    expect(outcome).toMatchObject({ kind: 'error', error: { kind: 'network' } });
  });

  it('gives up after the timeout', async () => {
    const outcome = await listModels({
      config,
      timeout: 5,
      fetch: fakeFetch(() => new Promise<Response>(() => {})),
    });
    expect(outcome).toMatchObject({ kind: 'error', error: { kind: 'timeout' } });
  });

  it('reports a timeout when the body never ends, not a missing list', async () => {
    const stalled = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            // Part of a list, then nothing more: a body cut here parses as no list.
            controller.enqueue(new TextEncoder().encode('{"data":[{"id":"gpt-'));
          },
        }),
        { status: 200 },
      );

    const outcome = await listModels({ config, timeout: 5, fetch: fakeFetch(stalled) });

    expect(outcome).toMatchObject({ kind: 'error', error: { kind: 'timeout' } });
  });

  it('reports a cancel during the body as cancelled', async () => {
    const caller = new AbortController();
    const stalled = () => {
      setTimeout(() => caller.abort(), 5);
      return new Response(new ReadableStream<Uint8Array>(), { status: 200 });
    };

    const outcome = await listModels({ config, signal: caller.signal, fetch: fakeFetch(stalled) });

    expect(outcome).toMatchObject({ kind: 'error', error: { kind: 'aborted' } });
  });

  it('sends nothing when the signal is already cancelled', async () => {
    const caller = new AbortController();
    caller.abort();
    const fetch = answers(json({ data: [{ id: 'gpt-test' }] }));

    const outcome = await listModels({ config, signal: caller.signal, fetch });

    expect(outcome).toMatchObject({ kind: 'error', error: { kind: 'aborted' } });
    expect(fetch).not.toHaveBeenCalled();
  });
});
