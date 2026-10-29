import { browser } from 'wxt/browser';
import { TRIGGER_SLOT, type TriggerSlotWire, type TriggerWire } from '@/contract/rpc-wire';
import { locale, t } from '@/domain/i18n/background';
import { isInjectableURL, withOriginsOnly } from '@/domain/url';
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
  /** Injects the content script, after leaving word of the trigger for it. */
  injectInto: (tabId: number, trigger: TriggerWire) => Promise<unknown>;
  markUnavailable: (tabId: number) => Promise<void>;
  /** Takes back what `markUnavailable` put on the icon: the page opened after all. */
  markAvailable: (tabId: number) => Promise<void>;
}

const browserDeps: InjectDeps = {
  storageIsolated: ensureLocalStorageIsolated,
  injectInto: async (tabId, trigger) => {
    // Runs in the content script's isolated world, just before it: the page
    // cannot see or forge it.
    await browser.scripting.executeScript({
      target: { tabId },
      func: (slot: string, value: TriggerSlotWire) => {
        (globalThis as unknown as Record<symbol, TriggerSlotWire>)[Symbol.for(slot)] = value;
      },
      args: [TRIGGER_SLOT, { ...trigger, locale: locale() }],
    });
    return browser.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT_FILE] });
  },
  markUnavailable,
  markAvailable,
};

/** A trigger that summarizes the page. */
export const PAGE_TRIGGER: TriggerWire = { mode: 'page', selectionText: '' };

/**
 * Opens the panel in `tab`: what every trigger does (toolbar icon, shortcut,
 * context menu). The gesture granted `activeTab`, which is what lets us
 * inject; nothing runs in a page the user did not ask about (D3 in
 * docs/development-plan.md). `trigger` says whether the panel works on the
 * page or on the selection (§4.6).
 */
export async function openPanelInTab(
  tab: TabLike,
  trigger: TriggerWire = PAGE_TRIGGER,
  deps: InjectDeps = browserDeps,
): Promise<void> {
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
    await deps.injectInto(tabId, trigger);
  } catch (error) {
    // The URL looked fine but the browser said no: an error page, the PDF viewer…
    // The browser's message quotes the page URL, which may carry a token:
    // only its origin goes into the log (AGENTS.md).
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('Could not inject into tab', tabId, withOriginsOnly(message));
    await deps.markUnavailable(tabId);
    return;
  }
  // An earlier attempt on this page may have marked the icon.
  await deps.markAvailable(tabId).catch(() => undefined);
}

/**
 * Tells the user, on the toolbar icon of this tab, that the page cannot be
 * summarized. There is no popup to explain it in. Chrome clears tab-specific
 * badge and title when the tab navigates or reloads; a later attempt on the
 * same page that works clears them too (`markAvailable`).
 */
async function markUnavailable(tabId: number): Promise<void> {
  await Promise.all([
    browser.action.setBadgeText({ tabId, text: '!' }),
    browser.action.setBadgeBackgroundColor({ tabId, color: '#8a8f98' }),
    browser.action.setTitle({ tabId, title: t('host.unavailable') }),
  ]);
}

async function markAvailable(tabId: number): Promise<void> {
  await Promise.all([
    browser.action.setBadgeText({ tabId, text: '' }),
    browser.action.setTitle({ tabId, title: browser.i18n.getMessage('actionTitle') }),
  ]);
}
