import { browser } from 'wxt/browser';
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
