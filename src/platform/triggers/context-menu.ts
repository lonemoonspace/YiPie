import { browser } from 'wxt/browser';
import { SUMMARIZE_MENU_ITEM, SUMMARIZE_SELECTION_MENU_ITEM } from '@/contract/commands';
import type { TriggerWire } from '@/contract/rpc-wire';
import { t } from '@/domain/i18n/background';
import { PAGE_TRIGGER, type TabLike } from '@/platform/inject/inject';
import { createLogger } from '@/platform/logger';

const logger = createLogger('context-menu');

/** The parts of `runtime` and `contextMenus` the menu uses. */
export interface ContextMenuApi {
  onInstalled: (listener: () => void) => void;
  removeAll: () => Promise<void>;
  create: (item: { id: string; title: string; contexts: ['page'] | ['selection'] }) => void;
  update: (id: string, change: { title: string }) => Promise<void>;
  onClicked: (
    listener: (
      info: { menuItemId: string | number; selectionText?: string },
      tab: TabLike | undefined,
    ) => void,
  ) => void;
}

const browserApi: ContextMenuApi = {
  onInstalled: (listener) => browser.runtime.onInstalled.addListener(() => listener()),
  removeAll: () => browser.contextMenus.removeAll(),
  create: (item) => {
    browser.contextMenus.create(item, () => {
      // Reported here, or Chrome logs it as unchecked.
      if (browser.runtime.lastError) {
        logger.error('Could not add the menu item:', browser.runtime.lastError.message);
      }
    });
  },
  update: async (id, change) => {
    await browser.contextMenus.update(id, change);
  },
  onClicked: (listener) =>
    browser.contextMenus.onClicked.addListener((info, tab) => listener(info, tab)),
};

/** The menu items with their titles in the current interface language. */
function items(): { id: string; title: string; contexts: ['page'] | ['selection'] }[] {
  return [
    { id: SUMMARIZE_MENU_ITEM, title: t('menu.summarizePage'), contexts: ['page'] },
    {
      id: SUMMARIZE_SELECTION_MENU_ITEM,
      title: t('menu.summarizeSelection'),
      contexts: ['selection'],
    },
  ];
}

/**
 * The right-click menu: 「总结此页」 on the page (docs/development-plan.md
 * §4.4), 「总结选中内容」 on selected text (§4.6); each shows alone, so
 * Chrome lists it directly rather than in a submenu. A click grants
 * `activeTab` for the tab, like the toolbar icon. Chrome keeps
 * menu items across service-worker restarts, so they are created when the
 * extension is installed or updated, after clearing what an older version
 * left, in the interface language once `localeReady` says the background
 * knows it. Call synchronously at service-worker start, so the click that
 * woke the worker is not missed.
 */
export function onContextMenu(
  open: (tab: TabLike, trigger: TriggerWire) => void,
  api: ContextMenuApi = browserApi,
  localeReady: () => Promise<void> = () => Promise.resolve(),
): void {
  api.onInstalled(() => {
    Promise.all([api.removeAll(), localeReady()])
      .then(() => {
        for (const item of items()) api.create(item);
      })
      .catch((error: unknown) => logger.error('Could not set up the menu:', error));
  });
  api.onClicked(({ menuItemId, selectionText }, tab) => {
    if (tab === undefined) return;
    if (menuItemId === SUMMARIZE_MENU_ITEM) open(tab, PAGE_TRIGGER);
    if (menuItemId === SUMMARIZE_SELECTION_MENU_ITEM) {
      open(tab, { mode: 'selection', selectionText: selectionText ?? '' });
    }
  });
}

/** Gives the menu items their titles in the interface language, after it changed. */
export async function retitleContextMenu(api: ContextMenuApi = browserApi): Promise<void> {
  await Promise.all(items().map(({ id, title }) => api.update(id, { title })));
}
