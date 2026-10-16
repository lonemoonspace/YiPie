import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  chromium,
  expect,
  test as base,
  type BrowserContext,
  type Frame,
  type Page,
  type Worker,
} from '@playwright/test';
import { startFakeServer, type FakeServer } from './fake-llm/server';

/**
 * The E2E build (`npm run build:e2e`): the production build plus host access
 * to 127.0.0.1 and a trigger hook, because Playwright cannot click the
 * toolbar icon (docs/development-plan.md §6).
 */
const extensionPath = path.resolve(import.meta.dirname, '../.output/chrome-mv3-e2e');

interface ExtensionFixtures {
  /**
   * The browser's own language, which an interface language of `auto`
   * follows. Chinese unless a test says otherwise (`test.use`).
   */
  browserLanguage: string;
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
  /** Does what a click on the toolbar icon does, for the tab showing `page`. */
  openPanel: (page: Page) => Promise<void>;
  /** The panel frame inside `page`, once it has loaded. */
  panelFrame: (page: Page) => Promise<Frame>;
}

interface WorkerFixtures {
  server: FakeServer;
}

export const test = base.extend<ExtensionFixtures, WorkerFixtures>({
  server: [
    async ({}, use) => {
      const server = await startFakeServer();
      await use(server);
      await server.close();
    },
    { scope: 'worker' },
  ],

  // Extensions need a persistent context with a fresh profile per test. The
  // `chromium` channel runs the new headless mode, which (unlike the headless
  // shell) can load extensions. The profile is in developer mode: only then
  // does Chromium load an unpacked extension again after `runtime.reload()`,
  // as the test of what an update leaves in a page needs (§4.5).
  browserLanguage: ['zh-CN', { option: true }],

  context: async ({ browserLanguage }, use) => {
    const profile = await mkdtemp(path.join(tmpdir(), 'yipie-e2e-'));
    await mkdir(path.join(profile, 'Default'));
    await writeFile(
      path.join(profile, 'Default', 'Preferences'),
      JSON.stringify({ extensions: { ui: { developer_mode: true } } }),
    );
    // The browser's language: `locale` sets it for pages, and on Linux the
    // service worker's `i18n.getUILanguage()` reads it from LANGUAGE.
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      locale: browserLanguage,
      env: { ...process.env, LANGUAGE: browserLanguage.replace('-', '_') },
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await use(context);
    await context.close();
    await rm(profile, { recursive: true, force: true });
  },

  serviceWorker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await extensionReady(worker);
    await use(worker);
  },

  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },

  openPanel: async ({ serviceWorker }, use) => {
    await use(async (page) => {
      const tabId = await tabIdOf(serviceWorker, page);
      await serviceWorker.evaluate(
        (id) => (globalThis as unknown as E2EGlobal).__yipieE2E.openPanel(id),
        tabId,
      );
    });
  },

  panelFrame: async ({ extensionId }, use) => {
    await use(async (page) => {
      const prefix = `chrome-extension://${extensionId}/panel.html`;
      let frame: Frame | undefined;
      await expect
        .poll(
          () =>
            (frame = page
              .frames()
              .find((candidate) => !candidate.isDetached() && candidate.url().startsWith(prefix))),
        )
        .toBeDefined();
      return frame as Frame;
    });
  },
});

export { expect };

/**
 * Waits until the browser has installed the extension APIs in `worker`. It
 * can be reported before that: `chrome` then holds only `csi` and
 * `loadTimes` (about 1 run in 20). Waiting means a test that touches storage
 * first does not race the worker's startup. A failed evaluate becomes a
 * value, so polling continues.
 */
async function extensionReady(worker: Worker): Promise<void> {
  await expect
    .poll(() =>
      worker
        .evaluate(() => typeof (globalThis as unknown as MaybeChromeGlobal).chrome?.storage?.local)
        .catch((error: unknown) => String(error)),
    )
    .toBe('object');
}

/**
 * Reloads the extension, as an update does (`runtime.reload()`), and returns
 * its new service worker. Content scripts already in pages stay, cut off.
 */
export async function reloadExtension(context: BrowserContext, worker: Worker): Promise<Worker> {
  await worker.evaluate(() => {
    // Answer first: the worker goes away with the extension.
    setTimeout(() => (globalThis as unknown as ChromeRuntimeGlobal).chrome.runtime.reload(), 10);
  });
  let next: Worker | undefined;
  await expect
    .poll(() => (next = context.serviceWorkers().find((candidate) => candidate !== worker)))
    .toBeDefined();
  await extensionReady(next as Worker);
  return next as Worker;
}

/**
 * Does what the right-click menu's 「总结选中内容」 does for the tab showing
 * `page`; `selectionText` is what the menu would report.
 */
export async function openPanelOnSelection(
  serviceWorker: Worker,
  page: Page,
  selectionText = '',
): Promise<void> {
  const tabId = await tabIdOf(serviceWorker, page);
  await serviceWorker.evaluate(
    ([id, text]) =>
      (globalThis as unknown as E2EGlobal).__yipieE2E.openPanel(id, {
        mode: 'selection',
        selectionText: text,
      }),
    [tabId, selectionText] as const,
  );
}

/** Does what a click on the toolbar icon does, with the given service worker. */
export async function openPanelWith(worker: Worker, tabId: number): Promise<void> {
  await worker.evaluate(
    (id) => (globalThis as unknown as E2EGlobal).__yipieE2E.openPanel(id),
    tabId,
  );
}

/** The id of the tab showing `page`; the E2E build can read 127.0.0.1 tab URLs. */
export async function tabIdOf(serviceWorker: Worker, page: Page): Promise<number> {
  const url = page.url();
  const id = await serviceWorker.evaluate(async (target) => {
    const { chrome } = globalThis as unknown as ChromeTabsGlobal;
    const tabs = await chrome.tabs.query({});
    return tabs.find((tab) => tab.url === target)?.id;
  }, url);
  if (id === undefined) throw new Error(`No tab shows ${url}`);
  return id;
}

/** The API key every E2E model configuration uses; tests check where it does and does not appear. */
export const E2E_KEY = 'sk-e2e-not-a-real-key';

/** Stores one model configuration pointing at the fake service, as the settings page would. */
export async function useModel(serviceWorker: Worker, server: FakeServer, model: string) {
  await storeModels(serviceWorker, server, [{ id: 'e2e', name: '', model }]);
}

export interface StoredModel {
  id: string;
  name: string;
  /** A fake-service scenario (`scenario:<name>`), sent as the model name. */
  model: string;
  /** `E2E_KEY` unless given. */
  apiKey?: string;
  /** Blank (`null`) unless given. */
  contextWindow?: number | null;
}

/**
 * Stores model configurations pointing at the fake service, in this order.
 * `extra` rows are stored after them as they are, such as rows no version can
 * read. No default is chosen: the first one is in use.
 */
export async function storeModels(
  serviceWorker: Worker,
  server: FakeServer,
  models: StoredModel[],
  { extra = [] }: { extra?: unknown[] } = {},
) {
  const data = [
    ...models.map((model) => ({
      apiKey: E2E_KEY,
      contextWindow: null,
      ...model,
      baseURL: `${server.origin}/v1`,
      headers: {},
      extraBody: {},
      streamUsage: true,
    })),
    ...extra,
  ];
  await store(serviceWorker, { 'model-configs': { version: 1, data } });
}

export interface StoredPrompt {
  id: string;
  name: string;
  system: string;
  user: string;
}

/** Stores prompts, in this order, in place of the built-in one. */
export async function storePrompts(serviceWorker: Worker, prompts: StoredPrompt[]) {
  await store(serviceWorker, { 'prompt-configs': { version: 1, data: prompts } });
}

/** Stores the chosen defaults. */
export async function storeDefaults(
  serviceWorker: Worker,
  defaults: { defaultModelId?: string; defaultPromptId?: string },
) {
  await store(serviceWorker, {
    selection: { version: 1, data: { defaultModelId: null, defaultPromptId: null, ...defaults } },
  });
}

/** Stores general settings, as the settings page would. */
export async function storeSettings(
  serviceWorker: Worker,
  settings: {
    trimming?: 'back' | 'middle' | 'front' | 'nothing';
    theme?: 'system' | 'light' | 'dark';
    fontSize?: 'small' | 'medium' | 'large' | 'x-large';
    answerLanguage?: string;
    interfaceLanguage?: 'auto' | 'zh-Hans' | 'en';
    autoSummarize?: boolean;
  },
) {
  await store(serviceWorker, {
    'general-settings': { version: 1, data: { theme: 'system', logLevel: 'info', ...settings } },
  });
}

/** Writes `storage.local` from the service worker, as the extension's own writes land there. */
async function store(serviceWorker: Worker, items: Record<string, unknown>) {
  await serviceWorker.evaluate(
    (values) => (globalThis as unknown as ChromeStorageGlobal).chrome.storage.local.set(values),
    items,
  );
}

/** What `storage.local` holds under `key`, read in the service worker. */
export async function stored(serviceWorker: Worker, key: string): Promise<unknown> {
  const all = await serviceWorker.evaluate(
    (name) => (globalThis as unknown as ChromeStorageGlobal).chrome.storage.local.get(name),
    key,
  );
  return all[key];
}

/** Everything in `storage.session`, read in the service worker: the panel registry and snapshots. */
export async function session(serviceWorker: Worker): Promise<Record<string, unknown>> {
  return serviceWorker.evaluate(() =>
    (globalThis as unknown as ChromeStorageGlobal).chrome.storage.session.get(null),
  );
}

/** The worker's global before the extension APIs are installed, as far as the fixture checks it. */
interface MaybeChromeGlobal {
  chrome?: { storage?: { local?: unknown } };
}

interface ChromeRuntimeGlobal {
  chrome: { runtime: { reload(): void } };
}

interface E2EGlobal {
  __yipieE2E: {
    openPanel(
      tabId: number,
      trigger?: { mode: 'page' | 'selection'; selectionText: string },
    ): Promise<void>;
  };
}

interface ChromeTabsGlobal {
  chrome: { tabs: { query(filter: object): Promise<{ id?: number; url?: string }[]> } };
}

/** The slice of the Chrome API the tests touch from inside the service worker. */
export interface ChromeStorageGlobal {
  chrome: {
    storage: {
      local: {
        get(key: string): Promise<Record<string, unknown>>;
        set(items: Record<string, unknown>): Promise<void>;
      };
      session: {
        get(key: string | null): Promise<Record<string, unknown>>;
      };
    };
  };
}
