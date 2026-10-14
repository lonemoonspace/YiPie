import { browser } from 'wxt/browser';

/**
 * Runs `handler` when the extension is installed or updated. Register
 * synchronously at service-worker start: the event may be what woke it.
 */
export function onInstalledOrUpdated(handler: () => void): void {
  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install' || details.reason === 'update') handler();
  });
}
