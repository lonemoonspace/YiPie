import { browser } from 'wxt/browser';
import { PAGE_CHANNEL, type PageReplyWire, type PageRequestWire } from '@/contract/rpc-wire';
import { extractPage } from './readability';

const INSTALLED = Symbol.for('yipie.page-requests');

/**
 * Answers the background's requests about this page. Installed once per
 * document, however many times the content script is injected.
 */
export function listenForPageRequests(): void {
  const scope = globalThis as unknown as Record<symbol, boolean | undefined>;
  if (scope[INSTALLED]) return;
  scope[INSTALLED] = true;

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    // Only our own background talks to our content script, but say so anyway.
    if (sender.id !== browser.runtime.id || !isPageRequest(message)) return false;
    let reply: PageReplyWire;
    try {
      reply = { ok: true, value: extractPage(document) };
    } catch (error) {
      reply = { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
    sendResponse(reply);
    return false;
  });
}

function isPageRequest(message: unknown): message is PageRequestWire {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as Partial<PageRequestWire>).channel === PAGE_CHANNEL &&
    (message as Partial<PageRequestWire>).type === 'extract'
  );
}
