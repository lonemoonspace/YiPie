import { browser } from 'wxt/browser';
import { t } from '@/domain/i18n';
import { isInjectableURL } from '@/domain/url';
import { createLogger } from '@/platform/logger';
import { ensureLocalStorageIsolated } from '@/platform/storage';

const logger = createLogger('inject');

/** The content script bundle, built from src/entrypoints/injected.ts. */
export const CONTENT_SCRIPT_FILE = '/injected.js';

export interface TabLike {
  id?: number;
  url?: string;
}

export interface InjectDeps {
  /** Resolves once storage.local is closed to content scripts (the fail-closed gate). */
  storageIsolated: () => Promise<void>;
  injectInto: (tabId: number) => Promise<unknown>;
  markUnavailable: (tabId: number) => Promise<void>;
}

const browserDeps: InjectDeps = {
  storageIsolated: ensureLocalStorageIsolated,
  injectInto: (tabId) =>
    browser.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT_FILE] }),
  markUnavailable,
};

/**
 * Opens the panel in `tab`: what every trigger does (toolbar icon, shortcut;
 * the context menu from phase 3). The gesture granted `activeTab`, which is
 * what lets us inject; nothing runs in a page the user did not ask about
 * (D3 in docs/development-plan.md).
 */
export async function openPanelInTab(tab: TabLike, deps: InjectDeps = browserDeps): Promise<void> {
  const tabId = tab.id;
  if (tabId === undefined) return;

  if (!isInjectableURL(tab.url)) {
    await deps.markUnavailable(tabId);
    return;
  }

  // Fail closed: a content script may only exist once storage.local is closed
  // to it. If the browser refuses, nothing is injected.
  try {
    await deps.storageIsolated();
  } catch (error) {
    logger.error('storage.local is not isolated; not injecting into tab', tabId, error);
    await deps.markUnavailable(tabId);
    return;
  }

  try {
    await deps.injectInto(tabId);
  } catch (error) {
    // The URL looked fine but the browser said no: an error page, the PDF viewer…
    logger.warn('Could not inject into tab', tabId, error);
    await deps.markUnavailable(tabId);
  }
}

/**
 * Tells the user, on the toolbar icon of this tab, that the page cannot be
 * summarized. There is no popup to explain it in. Chrome clears tab-specific
 * badge and title when the tab navigates or reloads, so nothing to undo.
 */
async function markUnavailable(tabId: number): Promise<void> {
  await Promise.all([
    browser.action.setBadgeText({ tabId, text: '!' }),
    browser.action.setBadgeBackgroundColor({ tabId, color: '#8a8f98' }),
    browser.action.setTitle({ tabId, title: t('host.unavailable') }),
  ]);
}
