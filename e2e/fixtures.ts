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
  // shell) can load extensions.
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await use(context);
    await context.close();
  },

  serviceWorker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    // The worker can be reported before the browser has installed the extension
    // APIs in it: `chrome` then holds only `csi` and `loadTimes` (about 1 run in
    // 20). Wait for them, so a test that touches storage first does not race the
    // worker's startup. A failed evaluate becomes a value, so polling continues.
    await expect
      .poll(() =>
        worker
          .evaluate(
            () => typeof (globalThis as unknown as MaybeChromeGlobal).chrome?.storage?.local,
          )
          .catch((error: unknown) => String(error)),
      )
      .toBe('object');
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
        .poll(() => (frame = page.frames().find((candidate) => candidate.url().startsWith(prefix))))
        .toBeDefined();
      return frame as Frame;
    });
  },
});

export { expect };

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
  await serviceWorker.evaluate(
    ({ baseURL, model, key }) =>
      (globalThis as unknown as ChromeStorageGlobal).chrome.storage.local.set({
        'model-configs': {
          version: 1,
          data: [
            {
              id: 'e2e',
              name: '',
              baseURL,
              apiKey: key,
              model,
              headers: {},
              extraBody: {},
              contextWindow: null,
              streamUsage: true,
            },
          ],
        },
      }),
    { baseURL: `${server.origin}/v1`, model, key: E2E_KEY },
  );
}

/** The worker's global before the extension APIs are installed, as far as the fixture checks it. */
interface MaybeChromeGlobal {
  chrome?: { storage?: { local?: unknown } };
}

interface E2EGlobal {
  __yipieE2E: { openPanel(tabId: number): Promise<void> };
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
        get(key: string): Promise<Record<string, unknown>>;
      };
    };
  };
}
