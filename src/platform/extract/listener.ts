import { browser } from 'wxt/browser';
import { PAGE_CHANNEL, type PageReplyWire, type PageRequestWire } from '@/contract/rpc-wire';
import { MAX_PAGE_TEXT_LENGTH, extractPage } from './readability';
import { rememberedSelection } from './selection';

const INSTALLED = Symbol.for('yipie.page-requests');

/**
 * Answers the background's requests about this page. Installed once per
 * document and extension runtime, however many times the content script is
 * injected: after an update or a reload, the new runtime needs its own
 * listener (panel-host/orphan.ts).
 */
export function listenForPageRequests(): void {
  const scope = globalThis as unknown as Record<symbol, unknown>;
  if (scope[INSTALLED] === browser.runtime) return;
  scope[INSTALLED] = browser.runtime;

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    // Only our own background talks to our content script, but say so anyway.
    if (sender.id !== browser.runtime.id || !isPageRequest(message)) return false;
    let reply: PageReplyWire;
    try {
      reply = {
        ok: true,
        value: extractPage(document, MAX_PAGE_TEXT_LENGTH, rememberedSelection()),
      };
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
