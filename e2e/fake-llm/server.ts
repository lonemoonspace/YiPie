import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { embeddingPage, PAGES, type FixturePage } from './pages';

export interface FakeServer {
  /** `http://127.0.0.1:<port>`; the E2E build has host access to it. */
  origin: string;
  close(): Promise<void>;
}

/**
 * The local server behind every E2E test: fixture pages now, and a scripted
 * OpenAI-compatible endpoint once the panel calls models
 * (docs/development-plan.md §6). Listens on a random port of 127.0.0.1.
 */
export async function startFakeServer(): Promise<FakeServer> {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
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
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
