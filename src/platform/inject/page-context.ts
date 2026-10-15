import { browser } from 'wxt/browser';
import { z } from 'zod';
import { PageContext } from '@/contract/page-context';
import { PAGE_CHANNEL, type PageReplyWire, type PageRequestWire } from '@/contract/rpc-wire';

/**
 * Asks our content script in `tabId` (top frame only) for the page text.
 * Its reply comes from the page's renderer, the least trusted party, so it is
 * parsed with the contract before the panel sees it.
 */
export async function requestPageContext(tabId: number): Promise<PageContext> {
  const request: PageRequestWire = { channel: PAGE_CHANNEL, type: 'extract' };
  const reply = await browser.tabs.sendMessage<PageRequestWire, PageReplyWire | undefined>(
    tabId,
    request,
    { frameId: 0 },
  );
  if (typeof reply !== 'object' || reply === null) throw new Error('The page did not answer.');
  if (!reply.ok) throw new Error(`Could not read the page: ${reply.message}`);
  return PageContext.parse(reply.value);
}

/** How a located quote is shown: inserted by the background, so the page's DOM stays as it is. */
export const QUOTE_HIGHLIGHT_CSS =
  '::highlight(yipie-quote) { background-color: rgba(255, 200, 0, 0.45); color: inherit; }';

/**
 * Asks our content script in `tabId` to find `quote`, scroll to it and
 * highlight it (docs/development-plan.md §4.6). The highlight's style is
 * inserted first, through `scripting.insertCSS`, removed and inserted again so
 * it is there once however often this runs. Resolves to whether the quote was
 * found.
 */
export async function requestLocate(tabId: number, quote: string): Promise<boolean> {
  const target = { tabId, frameIds: [0] };
  try {
    await browser.scripting.removeCSS({ target, css: QUOTE_HIGHLIGHT_CSS });
    await browser.scripting.insertCSS({ target, css: QUOTE_HIGHLIGHT_CSS });
  } catch {
    // No highlight, but the page still scrolls to the quote.
  }
  const request: PageRequestWire = { channel: PAGE_CHANNEL, type: 'locate', quote };
  const reply = await browser.tabs.sendMessage<PageRequestWire, PageReplyWire | undefined>(
    tabId,
    request,
    { frameId: 0 },
  );
  if (typeof reply !== 'object' || reply === null) throw new Error('The page did not answer.');
  if (!reply.ok) throw new Error(`Could not search the page: ${reply.message}`);
  return z.boolean().parse(reply.value);
}
