import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { openPanelInTab, type TabLike } from '@/platform/inject/inject';
import { requestPageContext } from '@/platform/inject/page-context';
import { createPanelRegistry } from '@/platform/inject/registry';
import { createLogger, setLogLevel } from '@/platform/logger';
import { releaseOriginAccess } from '@/platform/permissions/origin-access';
import { RpcRefusal } from '@/platform/rpc/errors';
import { registerRpcServer } from '@/platform/rpc/server';
import { onInstalledOrUpdated } from '@/platform/runtime/installed';
import { createBackupsService } from '@/platform/settings/backups-service';
import { createGeneralSettingsService } from '@/platform/settings/general-settings-service';
import { createModelConfigsService } from '@/platform/settings/model-configs-service';
import { panelSetup } from '@/platform/settings/panel-setup';
import { createPromptConfigsService } from '@/platform/settings/prompt-configs-service';
import { ensureLocalStorageIsolated, getExtensionStore, writeQueue } from '@/platform/storage';
import { onToolbarClick } from '@/platform/triggers/action';
import { onShortcut } from '@/platform/triggers/commands';

const logger = createLogger('background');

export default defineBackground(() => {
  const store = getExtensionStore();
  const settings = createGeneralSettingsService(store, writeQueue);
  const models = createModelConfigsService(store, writeQueue, { release: releaseOriginAccess });
  const prompts = createPromptConfigsService(store, writeQueue);
  const backups = createBackupsService(store, writeQueue);
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
      'models.remove': ({ id }) => models.remove(id),
      'models.move': ({ id, to }) => models.move(id, to),
      'models.setDefault': async ({ id }) => ({ defaultId: await models.setDefault(id) }),
      'prompts.list': () => prompts.list(),
      'prompts.add': (draft) => prompts.add(draft),
      'prompts.update': ({ id, patch }) => prompts.update(id, patch),
      'prompts.remove': ({ id }) => prompts.remove(id),
      'prompts.move': ({ id, to }) => prompts.move(id, to),
      'prompts.setDefault': async ({ id }) => ({ defaultId: await prompts.setDefault(id) }),
      'backups.list': () => backups.list(),
      'backups.remove': (ref) => backups.remove(ref),
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
      'panel.setup': () => panelSetup(models, prompts),
      // The dispatcher has checked that the caller is the panel attached in this tab.
      'page.getContext': async (_input, { tabId }) => {
        if (tabId === undefined) throw new RpcRefusal('forbidden', 'No tab to read.');
        return requestPageContext(tabId);
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

  // The built-in prompt goes into a list that was never written, so it can be
  // seen and edited; a list the user emptied stays empty.
  onInstalledOrUpdated(() => {
    prompts.seedIfMissing().catch((error: unknown) => {
      logger.error('Could not seed the built-in prompt:', error);
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
