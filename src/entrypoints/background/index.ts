import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { openPanelInTab, type TabLike } from '@/platform/inject/inject';
import { requestPageContext } from '@/platform/inject/page-context';
import { createPanelRegistry } from '@/platform/inject/registry';
import { createLogger, setLogLevel } from '@/platform/logger';
import { RpcRefusal } from '@/platform/rpc/errors';
import { registerRpcServer } from '@/platform/rpc/server';
import { createGeneralSettingsService } from '@/platform/settings/general-settings-service';
import { createModelConfigsService } from '@/platform/settings/model-configs-service';
import { ensureLocalStorageIsolated, getExtensionStore, writeQueue } from '@/platform/storage';
import { onToolbarClick } from '@/platform/triggers/action';
import { onShortcut } from '@/platform/triggers/commands';

const logger = createLogger('background');

export default defineBackground(() => {
  const store = getExtensionStore();
  const settings = createGeneralSettingsService(store, writeQueue);
  const models = createModelConfigsService(store, writeQueue);
  const panels = createPanelRegistry(store, writeQueue);

  // Register listeners first: the message or click being handled may be what
  // woke this worker. Handlers still wait until storage.local is closed to
  // content scripts.
  registerRpcServer(
    {
      'settings.get': () => settings.get(),
      'settings.patch': async (patch) => {
        const view = await settings.patch(patch);
        setLogLevel(view.settings.logLevel);
        return view;
      },
      'models.list': () => models.list(),
      'models.add': (draft) => models.add(draft),
      'models.update': ({ id, patch }) => models.update(id, patch),
      'content.hello': async (_input, { tabId }) => {
        if (tabId === undefined) throw new RpcRefusal('forbidden', 'No tab to mount a panel in.');
        return { nonce: await panels.issue(tabId) };
      },
      'panel.attach': async ({ nonce }, { tabId, documentId }) => {
        if (
          tabId === undefined ||
          documentId === undefined ||
          !(await panels.attach(tabId, nonce, documentId))
        ) {
          throw new RpcRefusal('forbidden', 'This panel was not mounted by YiPie in this tab.');
        }
        return { tabId };
      },
      'page.getContext': async (_input, { tabId, documentId }) => {
        if (
          tabId === undefined ||
          documentId === undefined ||
          !(await panels.isAttached(tabId, documentId))
        ) {
          throw new RpcRefusal('forbidden', 'Only the panel attached in this tab may read it.');
        }
        return requestPageContext(tabId);
      },
    },
    { storageIsolated: ensureLocalStorageIsolated },
  );

  const open = (tab: TabLike) => {
    openPanelInTab(tab).catch((error: unknown) => {
      logger.error('Could not open the panel:', error);
    });
  };
  onToolbarClick(open);
  onShortcut(open);

  // Close storage.local now rather than on the first request. If the browser
  // refuses, RPC stays refused and nothing is injected; each later attempt
  // asks again.
  ensureLocalStorageIsolated().catch((error: unknown) => {
    logger.error('Could not restrict storage.local to extension pages:', error);
  });

  settings
    .get()
    .then((view) => setLogLevel(view.settings.logLevel))
    .catch((error: unknown) => logger.error('Could not read the log level:', error));

  // Only in the E2E build: Playwright cannot click the toolbar icon or press
  // an extension shortcut (docs/development-plan.md §6). The production build
  // compiles this branch away; check:manifest verifies it.
  if (import.meta.env.MODE === 'e2e') {
    Object.assign(globalThis, {
      __yipieE2E: {
        openPanel: async (tabId: number) => openPanelInTab(await browser.tabs.get(tabId)),
      },
    });
  }
});
