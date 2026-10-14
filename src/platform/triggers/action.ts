import { browser } from 'wxt/browser';
import type { TabLike } from '@/platform/inject/inject';

/**
 * A click on the toolbar icon. The manifest declares no popup, so the click
 * reaches us and grants `activeTab` for the tab. Register synchronously at
 * service-worker start, so the click that woke the worker is not missed.
 */
export function onToolbarClick(open: (tab: TabLike) => void): void {
  browser.action.onClicked.addListener((tab) => open(tab));
}
