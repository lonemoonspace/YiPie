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
    let body: { model?: unknown } = {};
    try {
      body = JSON.parse(raw) as { model?: unknown };
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

    switch (body.model) {
      case 'scenario:normal':
        stream(
          [
            ': warming up\n\n',
            ...NORMAL_ANSWER.map(delta),
            `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 321, completion_tokens: 45, total_tokens: 366 } })}\n\n`,
            'data: [DONE]\n\n',
          ],
          20,
        );
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
