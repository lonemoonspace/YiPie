import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { handleChat, MODEL_IDS, type RecordedRequest } from './llm';
import { embeddingPage, PAGES, type FixturePage } from './pages';

export interface FakeServer {
  /** `http://127.0.0.1:<port>`; the E2E build has host access to it. */
  origin: string;
  /** Every chat request received so far, oldest first. */
  requests: RecordedRequest[];
  close(): Promise<void>;
}

/**
 * The local server behind every E2E test: fixture pages, and a scripted
 * OpenAI-compatible endpoint (docs/development-plan.md §6). Listens on a
 * random port of 127.0.0.1.
 */
export async function startFakeServer(): Promise<FakeServer> {
  const requests: RecordedRequest[] = [];

  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    // `/v1` is a service with a model list; `/no-models/v1` one without.
    if (request.method === 'POST' && url.pathname.endsWith('/v1/chat/completions')) {
      handleChat(request, response, requests);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/models') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ object: 'list', data: MODEL_IDS.map((id) => ({ id })) }));
      return;
    }

    const page: FixturePage | undefined =
      url.pathname === '/embed.html'
        ? embeddingPage(url.searchParams.get('ext') ?? '')
        : PAGES[url.pathname];
    if (page === undefined) {
      response.writeHead(404, { 'Content-Type': 'text/plain' });
      response.end('not found');
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...page.headers });
    response.end(page.body);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
