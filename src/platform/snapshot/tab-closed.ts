import { browser } from 'wxt/browser';

/**
 * A tab was closed: its conversations go with it (docs/development-plan.md
 * §4.4). Needs no permission. Register synchronously at service-worker start,
 * so the close that woke the worker is not missed.
 */
export function onTabClosed(listener: (tabId: number) => void): void {
  browser.tabs.onRemoved.addListener((tabId) => listener(tabId));
}
