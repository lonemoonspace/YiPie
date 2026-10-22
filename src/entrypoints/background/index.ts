import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { GENERAL_SETTINGS_KEY } from '@/contract/general-settings';
import type { GeneralSettingsView } from '@/contract/rpc';
import type { TriggerWire } from '@/contract/rpc-wire';
import { locale, setLocale } from '@/domain/i18n/background';
import { contentPageKey } from '@/domain/page-key';
import { openPanelInTab, type TabLike } from '@/platform/inject/inject';
import { requestLocate, requestPageContext } from '@/platform/inject/page-context';
import { createPanelRegistry } from '@/platform/inject/registry';
import { createLogger, setLogLevel } from '@/platform/logger';
import { releaseOriginAccess } from '@/platform/permissions/origin-access';
import { RpcRefusal } from '@/platform/rpc/errors';
import { registerRpcServer, type HandlerContext } from '@/platform/rpc/server';
import { createBackupsService } from '@/platform/settings/backups-service';
import { createConfigImport } from '@/platform/settings/config-import';
import { createGeneralSettingsService } from '@/platform/settings/general-settings-service';
import { createModelConfigsService } from '@/platform/settings/model-configs-service';
import { createPromptConfigsService } from '@/platform/settings/prompt-configs-service';
import { createSnapshotStore } from '@/platform/snapshot/store';
import { onTabClosed } from '@/platform/snapshot/tab-closed';
import { ensureLocalStorageIsolated, getExtensionStore, writeQueue } from '@/platform/storage';
import { onStoredChange } from '@/platform/storage/watch';
import { onToolbarClick } from '@/platform/triggers/action';
import { onShortcut } from '@/platform/triggers/commands';
import { onContextMenu, retitleContextMenu } from '@/platform/triggers/context-menu';

const logger = createLogger('background');

export default defineBackground(() => {
  const store = getExtensionStore();
  const settings = createGeneralSettingsService(store, writeQueue, {
    browserLanguage: () => browser.i18n.getUILanguage(),
  });
  const models = createModelConfigsService(store, writeQueue, {
    releaseOrigins: (patterns) => releaseOriginAccess(patterns),
  });
  // The built-in prompt is in the interface language (§4.7).
  const prompts = createPromptConfigsService(store, writeQueue, { locale });
  const backups = createBackupsService(store, writeQueue);
  const importConfig = createConfigImport(writeQueue, models, prompts);
  const panels = createPanelRegistry(store, writeQueue);
  const snapshots = createSnapshotStore(store, writeQueue, {
    attached: (tabId, documentId) => panels.isAttached(tabId, documentId),
  });

  /**
   * The tab and the page of the attached panel that sent a request. The
   * dispatcher has checked that it is attached; asking the registry again
   * also refuses a panel replaced in the meantime.
   */
  /**
   * What the worker itself takes from the general settings: the log level and
   * the interface language (for the menu, the icon's title and the built-in
   * prompt). Returns whether the language changed.
   */
  const applySettings = (view: GeneralSettingsView): boolean => {
    setLogLevel(view.settings.logLevel);
    const changed = view.locale !== locale();
    setLocale(view.locale);
    return changed;
  };
  // Read once at start. No handler runs before it is done, so the built-in
  // prompt and the menu are in the right language from the first request.
  const settingsRead = settings.get().then(
    (view) => void applySettings(view),
    (error: unknown) => logger.error('Could not read the general settings:', error),
  );
  // And again whenever they change, whoever wrote them.
  onStoredChange([GENERAL_SETTINGS_KEY], () => {
    settings
      .get()
      .then((view) => (applySettings(view) ? retitleContextMenu() : undefined))
      .catch((error: unknown) => logger.error('Could not apply the general settings:', error));
  });

  /**
   * Runs a panel's write in the queue, if the panel is still the one attached
   * then: the dispatcher checked before the write waited its turn.
   */
  const whileAttached = async <T>(
    { tabId, documentId }: HandlerContext,
    task: () => Promise<T>,
  ): Promise<T> => {
    const done =
      tabId === undefined || documentId === undefined
        ? null
        : await panels.whileAttached(tabId, documentId, task);
    if (done === null) {
      throw new RpcRefusal('forbidden', 'This panel is not the one attached in its tab.');
    }
    return done;
  };

  const panelPage = async ({ tabId, documentId }: HandlerContext) => {
    if (tabId !== undefined && documentId !== undefined) {
      const pageKey = await panels.pageKeyOf(tabId, documentId);
      if (pageKey !== null) return { tabId, pageKey, documentId };
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
      'settings.patch': (patch) => settings.patch(patch),
      'models.list': () => models.list(),
      'models.add': (draft) => models.add(draft),
      'models.update': ({ id, patch }) => models.update(id, patch),
      'models.remove': ({ id }) => models.remove(id),
      'models.move': ({ id, direction }) => models.move(id, direction),
      'models.setDefault': ({ id }) => models.setDefault(id),
      'models.current': () => models.current(),
      'models.choose': ({ id, model }, context) =>
        whileAttached(context, () => models.chooseUnqueued(id, model)),
      'models.disableStreamUsage': ({ id }) => models.disableStreamUsage(id),
      'prompts.list': () => prompts.list(),
      'prompts.add': (draft) => prompts.add(draft),
      'prompts.update': ({ id, patch }) => prompts.update(id, patch),
      'prompts.remove': ({ id }) => prompts.remove(id),
      'prompts.move': ({ id, direction }) => prompts.move(id, direction),
      'prompts.setDefault': ({ id }) => prompts.setDefault(id),
      'prompts.choose': ({ id }, context) =>
        whileAttached(context, () => prompts.setDefaultUnqueued(id)),
      'config.import': (input) => importConfig(input),
      'backups.list': () => backups.list(),
      'backups.remove': ({ key, at }) => backups.remove(key, at),
      // The page the panel is about to be mounted on, as the browser reports
      // it: the content script's tab URL, which follows a single-page app's
      // `pushState` (§4.4, detail 12).
      'content.hello': async ({ mode }, { tabId, url, tabUrl }) => {
        const pageKey = contentPageKey(tabUrl, url);
        if (tabId === undefined || pageKey === null) {
          throw new RpcRefusal('forbidden', 'No tab to mount a panel in.');
        }
        const [nonce, { theme, locale }] = await Promise.all([
          panels.issue(tabId, pageKey, mode),
          settings.current(),
        ]);
        return { nonce, pageKey, theme, locale };
      },
      'panel.attach': async ({ nonce }, { tabId, documentId }) => {
        if (
          tabId === undefined ||
          documentId === undefined ||
          !(await panels.attach(tabId, nonce, documentId))
        ) {
          throw new RpcRefusal('forbidden', 'This panel was not mounted by YiPie in this tab.');
        }
        return { tabId, mode: (await panels.modeOf(tabId, documentId)) ?? 'page' };
      },
      // The dispatcher has checked that the caller is the panel attached in this tab.
      'page.getContext': async (_input, { tabId }) => {
        if (tabId === undefined) throw new RpcRefusal('forbidden', 'No tab to read.');
        return requestPageContext(tabId);
      },
      'page.locate': async ({ quote }, { tabId }) => {
        if (tabId === undefined) throw new RpcRefusal('forbidden', 'No tab to search.');
        return { found: await requestLocate(tabId, quote) };
      },
      'snapshot.get': async (_input, context) => {
        const { tabId, pageKey } = await panelPage(context);
        return snapshots.get(tabId, pageKey);
      },
      'snapshot.save': async ({ messages, revision }, context) => {
        const { tabId, pageKey, documentId } = await panelPage(context);
        return snapshots.save(tabId, pageKey, messages, { documentId, revision });
      },
    },
    {
      storageIsolated: async () => {
        await ensureLocalStorageIsolated();
        await settingsRead;
      },
      panelAttached: (tabId, documentId) => panels.isAttached(tabId, documentId),
    },
  );

  const open = (tab: TabLike, trigger?: TriggerWire) => {
    openPanelInTab(tab, trigger).catch((error: unknown) => {
      logger.error('Could not open the panel:', error);
    });
  };
  onToolbarClick(open);
  onShortcut(open);
  onContextMenu(open, undefined, () => settingsRead);

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

  // Only in the E2E build: Playwright cannot click the toolbar icon or press
  // an extension shortcut (docs/development-plan.md §6). The production build
  // compiles this branch away; check:manifest verifies it.
  if (import.meta.env.MODE === 'e2e') {
    Object.assign(globalThis, {
      __yipieE2E: {
        openPanel: async (tabId: number, trigger?: TriggerWire) =>
          openPanelInTab(await browser.tabs.get(tabId), trigger),
      },
    });
  }
});
