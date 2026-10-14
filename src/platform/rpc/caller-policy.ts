import type { CallerKind } from '@/contract/rpc';

/** The parts of `runtime.MessageSender` the policy looks at. */
export interface SenderLike {
  id?: string;
  url?: string;
  tab?: unknown;
  frameId?: number;
}

const EXTENSION_PAGES = new Map<string, CallerKind>([
  ['/options.html', 'options'],
  ['/panel.html', 'panel'],
]);

/**
 * Works out which of our contexts sent a message, or `null` for anything else.
 *
 * Only browser-supplied sender fields are used, never the payload. A
 * compromised page renderer can make our content script send arbitrary
 * messages, but it cannot change where the browser says a message came from —
 * which is why each method lists the caller kinds it accepts, and content
 * scripts get the fewest.
 */
export function classifyCaller(sender: SenderLike, extensionId: string): CallerKind | null {
  if (sender.id !== extensionId || sender.url === undefined) return null;

  let url: URL;
  try {
    url = new URL(sender.url);
  } catch {
    return null;
  }

  if (url.protocol === 'chrome-extension:') {
    return url.host === extensionId ? (EXTENSION_PAGES.get(url.pathname) ?? null) : null;
  }

  // Our content scripts run only in the top frame of a tab.
  if (sender.tab !== undefined && sender.frameId === 0) return 'content';
  return null;
}
