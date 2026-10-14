import { browser } from 'wxt/browser';

/** Opens (or focuses) the settings page; extension pages only. */
export function openSettingsPage(): Promise<void> {
  return browser.runtime.openOptionsPage();
}
