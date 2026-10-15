import type { IncomingMessage, ServerResponse } from 'node:http';

/** What the fake service saw, for assertions. */
export interface RecordedRequest {
  path: string;
  authorization: string | undefined;
  origin: string | undefined;
  body: unknown;
  /** The client hung up before the answer was complete. */
  aborted: boolean;
}

/** The answer of `scenario:normal`, in the pieces it is streamed in. */
export const NORMAL_ANSWER = [
  '## 概要\n\n',
  '这篇文章介绍了',
  '**一瞥**：',
  '一个用你自己的模型',
  '总结网页的浏览器扩展。\n\n',
  '- 要点一：在页面里打开浮动面板\n',
  '- 要点二：回答流式显示\n',
];

const UNSAFE_ANSWER = [
  '<img src=x onerror="document.title=1">\n\n',
  '[点我](javascript:document.title=2) ',
  '![追踪像素](https://tracker.example/pixel.png) ',
  '[安全链接](https://example.com/ok)\n',
];

const delta = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`;

/** The reasoning `scenario:reasoning` streams before its answer. */
export const REASONING = ['用户想要', '这篇文章的', '总结。'];

const reasoningDelta = (reasoning: string) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: null, reasoning_content: reasoning } }] })}\n\n`;

const usageChunk = `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 321, completion_tokens: 45, total_tokens: 366 } })}\n\n`;

/** Characters of message text `scenario:context-limit` accepts, as a small local model would. */
export const CONTEXT_LIMIT_CHARS = 2_000;

interface ChatBody {
  model?: unknown;
  messages?: { role: string; content: string }[];
  stream_options?: unknown;
}

/**
 * POST /v1/chat/completions, scripted by the request's `model`
 * (docs/development-plan.md §6). No CORS headers: the panel's requests rely
 * on the host permission, as they do in production.
 */
export function handleChat(
  request: IncomingMessage,
  response: ServerResponse,
  log: RecordedRequest[],
): void {
  let raw = '';
  request.setEncoding('utf8');
  request.on('data', (part: string) => (raw += part));
  request.on('end', () => {
    let body: ChatBody = {};
    try {
      body = JSON.parse(raw) as ChatBody;
    } catch {
      // Recorded as received.
    }
    const entry: RecordedRequest = {
      path: request.url ?? '',
      authorization: request.headers.authorization,
      origin: request.headers.origin,
      body,
      aborted: false,
    };
    log.push(entry);

    let finished = false;
    response.on('close', () => {
      if (!finished) entry.aborted = true;
    });
    const stream = (parts: string[], gap: number) => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      let index = 0;
      const timer = setInterval(() => {
        if (response.destroyed) {
          clearInterval(timer);
          return;
        }
        const part = parts[index++];
        if (part === undefined) {
          clearInterval(timer);
          finished = true;
          response.end();
          return;
        }
        response.write(part);
      }, gap);
    };

    const messages = Array.isArray(body.messages) ? body.messages : [];
    const refuse = (status: number, error: object, headers: Record<string, string> = {}) => {
      finished = true;
      response.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      response.end(JSON.stringify({ error }));
    };

    // Busy for the first request with this exact model name, then fine: give
    // each test its own name (`scenario:busy-once:<anything>`).
    if (typeof body.model === 'string' && body.model.startsWith('scenario:busy-once')) {
      const seen = log.filter((logged) => (logged.body as ChatBody).model === body.model).length;
      if (seen === 1) {
        refuse(
          429,
          { message: 'Rate limit reached for requests', type: 'requests' },
          {
            'Retry-After': '1',
          },
        );
        return;
      }
      stream([...NORMAL_ANSWER.map(delta), usageChunk, 'data: [DONE]\n\n'], 10);
      return;
    }

    switch (body.model) {
      case 'scenario:normal':
        stream(
          [': warming up\n\n', ...NORMAL_ANSWER.map(delta), usageChunk, 'data: [DONE]\n\n'],
          20,
        );
        return;
      case 'scenario:no-usage':
        stream([...NORMAL_ANSWER.map(delta), 'data: [DONE]\n\n'], 10);
        return;
      // A summary, then an answer to each follow-up that names the question.
      case 'scenario:chat': {
        const followUp = messages.some((message) => message.role === 'assistant');
        const answer = followUp ? [`回答：${messages.at(-1)?.content ?? ''}`] : NORMAL_ANSWER;
        stream([...answer.map(delta), usageChunk, 'data: [DONE]\n\n'], 10);
        return;
      }
      // Refuses requests longer than a small context window, the way OpenAI does.
      case 'scenario:context-limit': {
        const length = messages.reduce((sum, message) => sum + message.content.length, 0);
        if (length > CONTEXT_LIMIT_CHARS) {
          finished = true;
          response.writeHead(400, { 'Content-Type': 'application/json' });
          response.end(
            JSON.stringify({
              error: {
                message: `This model's maximum context length is 2048 tokens. However, your messages resulted in ${length} tokens.`,
                type: 'invalid_request_error',
                code: 'context_length_exceeded',
              },
            }),
          );
          return;
        }
        stream([...NORMAL_ANSWER.map(delta), 'data: [DONE]\n\n'], 10);
        return;
      }
      // A reasoning model, the DeepSeek way: reasoning_content, then the answer.
      case 'scenario:reasoning':
        stream(
          [
            ...REASONING.map((text) => reasoningDelta(text)),
            ...NORMAL_ANSWER.map(delta),
            usageChunk,
            'data: [DONE]\n\n',
          ],
          10,
        );
        return;
      // An old gateway that does not know `stream_options` (appendix D).
      case 'scenario:no-stream-options':
        if (body.stream_options !== undefined) {
          refuse(400, {
            message: 'Unrecognized request argument supplied: stream_options',
            type: 'invalid_request_error',
          });
          return;
        }
        stream([...NORMAL_ANSWER.map(delta), 'data: [DONE]\n\n'], 10);
        return;
      case 'scenario:slow':
        stream(
          [...Array.from({ length: 40 }, (_, i) => delta(`片段${i + 1} `)), 'data: [DONE]\n\n'],
          150,
        );
        return;
      case 'scenario:stream-error':
        stream([delta('先输出一点'), 'data: {"error":{"message":"Upstream overloaded"}}\n\n'], 20);
        return;
      case 'scenario:unsafe':
        stream([...UNSAFE_ANSWER.map(delta), 'data: [DONE]\n\n'], 10);
        return;
      case 'scenario:unauthorized': {
        // Like services that echo the key they rejected.
        const key = (request.headers.authorization ?? '').replace(/^Bearer /, '');
        finished = true;
        response.writeHead(401, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify({
            error: { message: `Incorrect API key provided: ${key}`, type: 'invalid_request_error' },
          }),
        );
        return;
      }
      default:
        finished = true;
        response.writeHead(404, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify({ error: { message: `model ${String(body.model)} not found` } }),
        );
    }
  });
}
