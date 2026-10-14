import path from 'node:path';
import { chromium, expect, test as base, type BrowserContext, type Worker } from '@playwright/test';

const extensionPath = path.resolve(import.meta.dirname, '../.output/chrome-mv3');

interface ExtensionFixtures {
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
}

export const test = base.extend<ExtensionFixtures>({
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
});

export { expect };

/** The worker's global before the extension APIs are installed, as far as the fixture checks it. */
interface MaybeChromeGlobal {
  chrome?: { storage?: { local?: unknown } };
}

/** The slice of the Chrome API the tests touch from inside the service worker. */
export interface ChromeStorageGlobal {
  chrome: {
    storage: {
      local: {
        get(key: string): Promise<Record<string, unknown>>;
        set(items: Record<string, unknown>): Promise<void>;
      };
    };
  };
}
