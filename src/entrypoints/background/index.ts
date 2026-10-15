import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { pageKeyOf } from '@/domain/page-key';
import { openPanelInTab, type TabLike } from '@/platform/inject/inject';
import { requestPageContext } from '@/platform/inject/page-context';
import { createPanelRegistry } from '@/platform/inject/registry';
import { createLogger, setLogLevel } from '@/platform/logger';
import { releaseOriginAccess } from '@/platform/permissions/origin-access';
import { RpcRefusal } from '@/platform/rpc/errors';
import { registerRpcServer, type HandlerContext } from '@/platform/rpc/server';
import { createBackupsService } from '@/platform/settings/backups-service';
import { createGeneralSettingsService } from '@/platform/settings/general-settings-service';
import { createModelConfigsService } from '@/platform/settings/model-configs-service';
import { createPromptConfigsService } from '@/platform/settings/prompt-configs-service';
import { createSnapshotStore } from '@/platform/snapshot/store';
import { onTabClosed } from '@/platform/snapshot/tab-closed';
import { ensureLocalStorageIsolated, getExtensionStore, writeQueue } from '@/platform/storage';
import { onToolbarClick } from '@/platform/triggers/action';
import { onShortcut } from '@/platform/triggers/commands';

const logger = createLogger('background');

export default defineBackground(() => {
  const store = getExtensionStore();
  const settings = createGeneralSettingsService(store, writeQueue);
  const models = createModelConfigsService(store, writeQueue, {
    releaseOrigins: (patterns) => releaseOriginAccess(patterns),
  });
  const prompts = createPromptConfigsService(store, writeQueue);
  const backups = createBackupsService(store, writeQueue);
  const panels = createPanelRegistry(store, writeQueue);
  const snapshots = createSnapshotStore(store, writeQueue);

  /**
   * The tab and the page of the attached panel that sent a request. The
   * dispatcher has checked that it is attached; asking the registry again
   * also refuses a panel replaced in the meantime.
   */
  const panelPage = async ({ tabId, documentId }: HandlerContext) => {
    if (tabId !== undefined && documentId !== undefined) {
      const pageKey = await panels.pageKeyOf(tabId, documentId);
      if (pageKey !== null) return { tabId, pageKey };
    }
    throw new RpcRefusal('forbidden', 'This panel is not the one attached in its tab.');
  };

  // Register listeners first: the message or click being handled may be what
  // woke this worker. Handlers still wait until storage.local is closed to
  // content scripts.
  registerRpcServer(
    {
      'settings.get': () => settings.get(),
      'settings.current': () => settings.current(),
      'settings.patch': async (patch) => {
        const view = await settings.patch(patch);
        setLogLevel(view.settings.logLevel);
        return view;
      },
      'models.list': () => models.list(),
      'models.add': (draft) => models.add(draft),
      'models.update': ({ id, patch }) => models.update(id, patch),
      'models.remove': ({ id }) => models.remove(id),
      'models.move': ({ id, direction }) => models.move(id, direction),
      'models.setDefault': ({ id }) => models.setDefault(id),
      'models.current': () => models.current(),
      'models.choose': ({ id }) => models.choose(id),
      'prompts.list': () => prompts.list(),
      'prompts.add': (draft) => prompts.add(draft),
      'prompts.update': ({ id, patch }) => prompts.update(id, patch),
      'prompts.remove': ({ id }) => prompts.remove(id),
      'prompts.move': ({ id, direction }) => prompts.move(id, direction),
      'prompts.setDefault': ({ id }) => prompts.setDefault(id),
      'backups.list': () => backups.list(),
      'backups.remove': ({ key, at }) => backups.remove(key, at),
      // The URL is the one the browser reports for the content script's
      // frame, the page the panel is about to be mounted on.
      'content.hello': async (_input, { tabId, url }) => {
        if (tabId === undefined || url === undefined) {
          throw new RpcRefusal('forbidden', 'No tab to mount a panel in.');
        }
        return { nonce: await panels.issue(tabId, pageKeyOf(url)) };
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
      // The dispatcher has checked that the caller is the panel attached in this tab.
      'page.getContext': async (_input, { tabId }) => {
        if (tabId === undefined) throw new RpcRefusal('forbidden', 'No tab to read.');
        return requestPageContext(tabId);
      },
      'snapshot.get': async (_input, context) => {
        const { tabId, pageKey } = await panelPage(context);
        return snapshots.get(tabId, pageKey);
      },
      'snapshot.save': async ({ messages }, context) => {
        const { tabId, pageKey } = await panelPage(context);
        return snapshots.save(tabId, pageKey, messages);
      },
    },
    {
      storageIsolated: ensureLocalStorageIsolated,
      panelAttached: (tabId, documentId) => panels.isAttached(tabId, documentId),
    },
  );

  const open = (tab: TabLike) => {
    openPanelInTab(tab).catch((error: unknown) => {
      logger.error('Could not open the panel:', error);
    });
  };
  onToolbarClick(open);
  onShortcut(open);

  // A closed tab's conversations and panel entry go with it (§4.4). This
  // wakes the worker on every tab close: the plan asks for deletion right
  // away rather than whenever the space is next needed.
  onTabClosed((tabId) => {
    Promise.all([snapshots.removeTab(tabId), panels.remove(tabId)]).catch((error: unknown) => {
      logger.error('Could not clean up after a closed tab:', error);
    });
  });

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
