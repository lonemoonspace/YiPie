import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ModelConfig } from '@/contract/model-config';
import { isLocalOriginRefusal, type LlmErrorKind } from '@/domain/llm/errors';
import type { Usage } from '@/domain/llm/stream';
import { streamChat, type ChatOptions } from '@/platform/llm/client';

/**
 * The compatibility corpus (docs/development-plan.md §4.5, appendix D): what
 * real services send, kept verbatim in tests/fixtures/sse, run through the
 * client. Every row of appendix D has at least one case here.
 */

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, '../../fixtures/sse', name), 'utf8');

const config = ModelConfig.parse({
  id: 'm',
  baseURL: 'http://localhost:11434/v1',
  apiKey: 'sk-corpus',
  model: 'corpus-model',
});

/** How a body is cut into network chunks: whole, or in small pieces that split events and characters. */
type Delivery = 'whole' | 'pieces' | 'crlf';

function body(
  text: string,
  delivery: Delivery,
  firstByteDelay: number,
): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(delivery === 'crlf' ? text.replace(/\n/g, '\r\n') : text);
  const size = delivery === 'whole' ? bytes.length : 7;
  let offset = 0;
  return new ReadableStream({
    async pull(controller) {
      if (offset === 0 && firstByteDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, firstByteDelay));
      }
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + size));
      offset += size;
    },
  });
}

interface Case {
  /** The row of appendix D. */
  row: string;
  name: string;
  file: string;
  status?: number;
  config?: Partial<ChatOptions['config']>;
  firstByteDelay?: number;
  options?: Partial<ChatOptions>;
  expected: {
    kind: 'done' | LlmErrorKind;
    text?: string;
    reasoning?: string;
    usage?: Usage | null;
    status?: number;
    detail?: string;
    /** Requests sent, the automatic retry included. */
    requests?: number;
  };
}

const CASES: Case[] = [
  {
    row: '流式响应默认不带 usage',
    name: 'OpenAI, asked for usage, sends it in a last chunk without choices',
    file: 'openai-usage.sse',
    expected: {
      kind: 'done',
      text: '## 概要\n\n这篇文章介绍了一瞥。',
      usage: { promptTokens: 1520, completionTokens: 86, totalTokens: 1606 },
    },
  },
  {
    row: '流式响应默认不带 usage',
    name: 'a service that sends no usage leaves it to the estimate',
    file: 'openai-no-usage.sse',
    expected: { kind: 'done', text: '没有用量的回答', usage: null },
  },
  {
    row: '不认识 stream_options，直接返回 400',
    name: 'an old Azure API version refuses it, then takes the request without it',
    file: 'stream-options-refused.json',
    status: 400,
    expected: { kind: 'done', text: '## 概要\n\n这篇文章介绍了一瞥。', requests: 2 },
  },
  {
    row: '不认识 stream_options，直接返回 400',
    name: 'vLLM refuses it as an extra input',
    file: 'vllm-extra-forbidden.json',
    status: 400,
    expected: { kind: 'done', requests: 2 },
  },
  {
    row: '推理内容的字段不统一',
    name: 'DeepSeek sends reasoning_content',
    file: 'deepseek-reasoning-content.sse',
    expected: {
      kind: 'done',
      text: '## 概要\n\n一瞥是浏览器扩展。',
      reasoning: '用户想要一份总结。',
      usage: { promptTokens: 1200, completionTokens: 300, totalTokens: 1500 },
    },
  },
  {
    row: '推理内容的字段不统一',
    name: 'OpenRouter sends reasoning',
    file: 'openrouter-reasoning.sse',
    expected: {
      kind: 'done',
      text: '概要：一瞥是浏览器扩展。',
      reasoning: 'Okay, the user wants a summary.',
    },
  },
  {
    row: '推理内容的字段不统一',
    name: 'an older Ollama writes <think>…</think> into the answer',
    file: 'ollama-think-tags.sse',
    expected: { kind: 'done', text: '**概要**：一瞥。', reasoning: '\n嗯，用户要总结。\n' },
  },
  {
    row: 'SSE 注释行 / 心跳',
    name: 'comments while queued keep a slow stream alive, and are not the answer',
    file: 'deepseek-reasoning-content.sse',
    options: { idleTimeout: 1_000 },
    expected: {
      kind: 'done',
      text: '## 概要\n\n一瞥是浏览器扩展。',
      reasoning: '用户想要一份总结。',
    },
  },
  {
    row: 'SSE 注释行 / 心跳',
    name: 'lines that are no SSE field (a vendor header, a blank keep-alive) are skipped (#21)',
    file: 'vendor-field-lines.sse',
    expected: { kind: 'done', text: '有厂商字段', requests: 1 },
  },
  {
    row: '200 流中途发来错误事件',
    name: 'OpenRouter reports a provider failure after some text, which stays',
    file: 'openrouter-midstream-error.sse',
    expected: {
      kind: 'server',
      status: 502,
      text: '概要：',
      detail: 'Provider returned error',
      requests: 1,
    },
  },
  {
    row: '200 流中途发来错误事件',
    name: 'a failure before any text is tried once more',
    file: 'openrouter-error-before-text.sse',
    expected: { kind: 'rate-limit', status: 429, text: '', requests: 2 },
  },
  {
    row: '200 流中途发来错误事件',
    name: 'an event named error, as gateways in front of Anthropic models send',
    file: 'gateway-error-event.sse',
    expected: { kind: 'server', text: '先说', detail: 'Overloaded', requests: 1 },
  },
  {
    row: '错误体格式不统一',
    name: 'the OpenAI error object',
    file: 'openai-invalid-request.json',
    status: 400,
    expected: {
      kind: 'bad-request',
      status: 400,
      detail:
        "Invalid 'messages[1].content': string too long. Expected a string with maximum length 10485760, but got a string with length 10500000 instead.",
    },
  },
  {
    row: '错误体格式不统一',
    name: 'plain text from a gateway',
    file: 'gateway-timeout.txt',
    status: 504,
    expected: { kind: 'server', status: 504, detail: 'upstream request timeout', requests: 2 },
  },
  {
    row: '错误体格式不统一',
    name: 'the HTML page of a gateway',
    file: 'nginx-502.html',
    status: 502,
    expected: {
      kind: 'server',
      status: 502,
      detail: '502 Bad Gateway 502 Bad Gateway nginx',
      requests: 2,
    },
  },
  {
    row: '错误体格式不统一',
    name: 'a gateway answers 200 with an HTML page: its words, not a network failure (#21)',
    file: 'gateway-200-html.html',
    expected: {
      kind: 'unknown',
      detail: 'The service did not send a stream: Upgrade required Your plan has run out',
      requests: 1,
    },
  },
  {
    row: '错误体格式不统一',
    name: 'a bare JSON error behind a 200, without a line break at the end (#21)',
    file: 'bare-json-error-200.json',
    expected: {
      kind: 'unknown',
      detail: 'The service did not send a stream: quota exceeded',
      requests: 1,
    },
  },
  {
    row: '错误体格式不统一',
    name: 'a bare JSON error behind a 200, with a line break at the end (#21)',
    file: 'bare-json-error-200-newline.json',
    expected: {
      kind: 'unknown',
      detail: 'The service did not send a stream: quota exceeded',
      requests: 1,
    },
  },
  {
    row: '200 流中途发来错误事件',
    name: 'an event named error whose data is a JSON string (#21)',
    file: 'error-event-string.sse',
    expected: { kind: 'server', detail: 'Overloaded', text: '' },
  },
  {
    row: '超长上下文',
    name: 'OpenAI refuses with context_length_exceeded',
    file: 'openai-context-length.json',
    status: 400,
    expected: { kind: 'context-length', status: 400, requests: 1 },
  },
  {
    row: '拒绝 chrome-extension:// 来源',
    name: 'Ollama answers 403 with nothing else',
    file: 'gateway-timeout.txt',
    status: 403,
    expected: { kind: 'auth', status: 403, requests: 1 },
  },
  {
    row: '首字节很慢',
    name: 'a first byte later than the idle timeout is still waited for',
    file: 'openai-usage.sse',
    firstByteDelay: 80,
    options: { idleTimeout: 40, firstByteTimeout: 1_000 },
    expected: { kind: 'done', text: '## 概要\n\n这篇文章介绍了一瞥。' },
  },
  {
    row: 'base URL 写法不一',
    name: 'a base URL without its /v1 meets a 404 page',
    file: 'apache-404.html',
    status: 404,
    config: { baseURL: 'https://api.example.com' },
    expected: {
      kind: 'not-found',
      status: 404,
      detail: '404 Not Found Not Found The requested URL was not found on this server.',
    },
  },
];

/** Every row of appendix D. */
const ROWS = [
  '流式响应默认不带 usage',
  '不认识 stream_options，直接返回 400',
  '推理内容的字段不统一',
  'SSE 注释行 / 心跳',
  '200 流中途发来错误事件',
  '错误体格式不统一',
  '超长上下文',
  '拒绝 chrome-extension:// 来源',
  '首字节很慢',
  '`max_tokens` / `temperature` 的兼容性',
  'base URL 写法不一',
];

/**
 * Answers with the fixture; a refusal of `stream_options` is followed by the
 * OpenAI stream, as the service answers once the field is gone.
 */
function serve(test: Case, delivery: Delivery) {
  const status = test.status ?? 200;
  return vi.fn((_url: string | URL | Request, init?: RequestInit) => {
    const sent = typeof init?.body === 'string' ? (JSON.parse(init.body) as object) : {};
    if (status !== 200 && !('stream_options' in sent) && test.file.endsWith('.json')) {
      return Promise.resolve(new Response(body(fixture('openai-usage.sse'), delivery, 0)));
    }
    const text = fixture(test.file);
    return Promise.resolve(
      status === 200
        ? new Response(body(text, delivery, test.firstByteDelay ?? 0), {
            headers: { 'Content-Type': 'text/event-stream' },
          })
        : new Response(text, { status }),
    );
  });
}

describe('the compatibility corpus (appendix D)', () => {
  it('has a case for every row', () => {
    const covered = new Set(CASES.map((test) => test.row));
    // max_tokens and temperature are checked on every request below.
    covered.add('`max_tokens` / `temperature` 的兼容性');
    expect(ROWS.filter((row) => !covered.has(row))).toEqual([]);
  });

  describe.each(['whole', 'pieces', 'crlf'] as const)('delivered %s', (delivery) => {
    it.each(CASES)('$row: $name', async (test) => {
      const fetch = serve(test, delivery);
      let text = '';
      let reasoning = '';

      const outcome = await streamChat({
        config: { ...config, ...test.config },
        messages: [{ role: 'user', content: '总结' }],
        signal: new AbortController().signal,
        onText: (piece) => (text += piece),
        onReasoning: (piece) => (reasoning += piece),
        hasAccess: () => Promise.resolve(true),
        sleep: () => Promise.resolve(),
        fetch,
        ...test.options,
      });

      const { expected } = test;
      if (expected.kind === 'done') {
        expect(outcome.kind).toBe('done');
        if (expected.usage !== undefined && outcome.kind === 'done') {
          expect(outcome.usage).toEqual(expected.usage);
        }
      } else {
        expect(outcome).toMatchObject({ kind: 'error', error: { kind: expected.kind } });
        if (outcome.kind === 'error') {
          if (expected.status !== undefined) expect(outcome.error.status).toBe(expected.status);
          if (expected.detail !== undefined) expect(outcome.error.detail).toEqual(expected.detail);
        }
      }
      if (expected.text !== undefined) expect(text).toBe(expected.text);
      expect(reasoning).toBe(expected.reasoning ?? '');
      if (expected.requests !== undefined) expect(fetch).toHaveBeenCalledTimes(expected.requests);

      // Appendix D: never max_tokens or temperature, unless the user adds them.
      for (const [, init] of fetch.mock.calls) {
        const sent = typeof init?.body === 'string' ? (JSON.parse(init.body) as object) : {};
        for (const field of ['max_tokens', 'max_completion_tokens', 'temperature']) {
          expect(sent).not.toHaveProperty(field);
        }
      }
    });
  });

  it('points a refusal by a local service at OLLAMA_ORIGINS', async () => {
    const outcome = await streamChat({
      config,
      messages: [],
      signal: new AbortController().signal,
      onText: () => undefined,
      fetch: () => Promise.resolve(new Response('', { status: 403 })),
    });

    expect(
      outcome.kind === 'error' && isLocalOriginRefusal(outcome.error, 'http://localhost:11434'),
    ).toBe(true);
  });

  it('asks the right endpoint when /chat/completions was pasted into the base URL', async () => {
    const fetch = serve(CASES[0] as Case, 'whole');
    await streamChat({
      config: { ...config, baseURL: 'http://localhost:11434/v1/chat/completions/' },
      messages: [],
      signal: new AbortController().signal,
      onText: () => undefined,
      fetch,
    });

    expect(fetch.mock.calls[0]?.[0]).toBe('http://localhost:11434/v1/chat/completions');
  });
});
