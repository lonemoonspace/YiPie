import { browser } from 'wxt/browser';
import { SUMMARIZE_COMMAND } from '@/contract/commands';
import type { TabLike } from '@/platform/inject/inject';

/**
 * The keyboard shortcut, which grants `activeTab` just like a click on the
 * icon. Register synchronously at service-worker start.
 */
export function onShortcut(open: (tab: TabLike) => void): void {
  browser.commands.onCommand.addListener((command, tab) => {
    if (command === SUMMARIZE_COMMAND && tab !== undefined) open(tab);
  });
}
