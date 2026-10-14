import type { Page, Worker } from '@playwright/test';
import { expect, tabIdOf, test, type ChromeStorageGlobal } from './fixtures';

interface HostInfo {
  tag: string;
  shadowRootVisibleToPage: boolean;
  width: number;
  height: number;
  right: number;
  top: number;
}

/** Our host as the page sees it: a child of <html> whose shadow root is closed. */
function readHost(page: Page): Promise<HostInfo | null> {
  return page.evaluate(() => {
    const host = [...document.documentElement.children].find((element) =>
      element.tagName.toLowerCase().startsWith('yipie-panel-'),
    );
    if (!host) return null;
    const box = host.getBoundingClientRect();
    return {
      tag: host.tagName.toLowerCase(),
      shadowRootVisibleToPage: host.shadowRoot !== null,
      width: box.width,
      height: box.height,
      right: window.innerWidth - box.right,
      top: box.top,
    };
  });
}

/** The document the background accepted as this tab's panel, if any. */
async function attachedDocument(serviceWorker: Worker, tabId: number): Promise<string | null> {
  return serviceWorker.evaluate(async (id) => {
    const { chrome } = globalThis as unknown as ChromeStorageGlobal;
    const stored = await chrome.storage.session.get('panel-registry');
    const registry = stored['panel-registry'] as
      { data: Record<string, { attachedDocument: string | null }> } | undefined;
    return registry?.data[String(id)]?.attachedDocument ?? null;
  }, tabId);
}

test('the trigger opens the panel in the page, and the panel attaches', async ({
  context,
  server,
  serviceWorker,
  openPanel,
  panelFrame,
}) => {
  const page = await context.newPage();
  await page.goto(`${server.origin}/article.html`);

  await openPanel(page);
  const frame = await panelFrame(page);

  await expect(frame.locator('main')).toHaveAttribute('data-attach', 'attached');
  expect(await attachedDocument(serviceWorker, await tabIdOf(serviceWorker, page))).not.toBeNull();
  const host = await readHost(page);
  expect(host).toMatchObject({ shadowRootVisibleToPage: false, right: 16, top: 16 });
  expect(host?.width).toBeGreaterThan(280);
  expect(host?.height).toBeGreaterThan(200);
});

for (const [situation, path] of [
  ['a strict Content-Security-Policy', '/strict-csp.html'],
  ['Cross-Origin-Embedder-Policy: require-corp', '/coep.html'],
] as const) {
  test(`the panel loads in a page with ${situation}`, async ({
    context,
    server,
    openPanel,
    panelFrame,
  }) => {
    const page = await context.newPage();
    await page.goto(`${server.origin}${path}`);

    await openPanel(page);

    await expect((await panelFrame(page)).locator('main')).toHaveAttribute(
      'data-attach',
      'attached',
    );
    // Styled through the CSSOM, so the page's style-src does not flatten the shell.
    expect((await readHost(page))?.width).toBeGreaterThan(280);
  });
}

test('elements the page planted do not stand in for ours', async ({
  context,
  server,
  openPanel,
  panelFrame,
}) => {
  const page = await context.newPage();
  await page.goto(`${server.origin}/planted.html`);

  await openPanel(page);

  await expect((await panelFrame(page)).locator('main')).toHaveAttribute('data-attach', 'attached');
  expect(await page.locator('#planted').count()).toBe(1);
  expect((await readHost(page))?.tag).toMatch(/^yipie-panel-[0-9a-f]{8}$/);
});

test('triggering again keeps the one panel', async ({ context, server, openPanel, panelFrame }) => {
  const page = await context.newPage();
  await page.goto(`${server.origin}/article.html`);

  await openPanel(page);
  await panelFrame(page);
  await openPanel(page);

  expect(
    await page.evaluate(
      () =>
        [...document.documentElement.children].filter((element) =>
          element.tagName.toLowerCase().startsWith('yipie-panel-'),
        ).length,
    ),
  ).toBe(1);
});

test('the panel comes back, freshly attached, when the page removes it', async ({
  context,
  server,
  serviceWorker,
  openPanel,
  panelFrame,
}) => {
  const page = await context.newPage();
  await page.goto(`${server.origin}/article.html`);
  const tabId = await tabIdOf(serviceWorker, page);
  await openPanel(page);
  await expect((await panelFrame(page)).locator('main')).toHaveAttribute('data-attach', 'attached');
  const first = await attachedDocument(serviceWorker, tabId);

  await page.evaluate(() => {
    for (const element of [...document.documentElement.children]) {
      if (element.tagName.toLowerCase().startsWith('yipie-panel-')) element.remove();
    }
  });

  // A new nonce first (no document attached yet), then the new panel attaches.
  await expect
    .poll(async () => {
      const current = await attachedDocument(serviceWorker, tabId);
      return current !== null && current !== first;
    })
    .toBe(true);
  expect(await readHost(page)).not.toBeNull();
});

test('a page cannot embed the panel itself', async ({
  context,
  server,
  serviceWorker,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`${server.origin}/embed.html?ext=${extensionId}`);

  // Only the per-session dynamic URL is web-accessible; the static one fails.
  await expect
    .poll(() => page.frames().map((frame) => frame.url()))
    .toContain('chrome-error://chromewebdata/');
  expect(page.frames().some((frame) => frame.url().includes('/panel.html'))).toBe(false);
  expect(await attachedDocument(serviceWorker, await tabIdOf(serviceWorker, page))).toBeNull();
});

test('our content script cannot read storage.local', async ({
  context,
  server,
  serviceWorker,
  openPanel,
  panelFrame,
}) => {
  const page = await context.newPage();
  await page.goto(`${server.origin}/article.html`);
  await openPanel(page);
  await panelFrame(page);
  const tabId = await tabIdOf(serviceWorker, page);

  // `func` runs in the same isolated world as our content script.
  const outcome = await serviceWorker.evaluate(async (id) => {
    const { chrome } = globalThis as unknown as ScriptingGlobal;
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: id },
      func: async () => {
        const { chrome: inPage } = globalThis as unknown as {
          chrome: { storage: { local: { get(key: null): Promise<unknown> } } };
        };
        try {
          await inPage.storage.local.get(null);
          return 'readable';
        } catch (error) {
          return `blocked: ${String(error)}`;
        }
      },
    });
    return result?.result;
  }, tabId);

  expect(outcome).toMatch(/^blocked/);
});

test('a page we may not script gets a badge instead of a panel', async ({
  context,
  server,
  serviceWorker,
  openPanel,
}) => {
  const page = await context.newPage();
  await page.goto(`${server.origin}/article.html`);
  const tabId = await tabIdOf(serviceWorker, page);
  await page.goto('about:blank');

  await serviceWorker.evaluate(
    (id) => (globalThis as unknown as E2EHook).__yipieE2E.openPanel(id),
    tabId,
  );

  const badge = () =>
    serviceWorker.evaluate(async (id) => {
      const { chrome } = globalThis as unknown as ActionGlobal;
      return {
        text: await chrome.action.getBadgeText({ tabId: id }),
        title: await chrome.action.getTitle({ tabId: id }),
      };
    }, tabId);
  expect(await badge()).toEqual({ text: '!', title: '此页面无法总结' });
  expect(await readHost(page)).toBeNull();

  // Chrome drops the tab-specific badge on navigation; the page then works.
  await page.goto(`${server.origin}/article.html`);
  expect((await badge()).text).toBe('');
  await openPanel(page);
  expect(await readHost(page)).not.toBeNull();
});

test('closing the panel removes it, and the next trigger brings a new one', async ({
  context,
  server,
  serviceWorker,
  openPanel,
  panelFrame,
}) => {
  const page = await context.newPage();
  await page.goto(`${server.origin}/article.html`);
  const tabId = await tabIdOf(serviceWorker, page);
  await openPanel(page);
  await expect((await panelFrame(page)).locator('main')).toHaveAttribute('data-attach', 'attached');
  const first = await attachedDocument(serviceWorker, tabId);

  // The close button sits at the right end of the title bar, inside the closed shadow root.
  const host = await readHost(page);
  if (!host) throw new Error('no host');
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  await page.mouse.click(viewport.width - host.right - 19, host.top + 17);

  await expect.poll(() => readHost(page)).toBeNull();
  expect(page.frames().some((frame) => frame.url().includes('/panel.html'))).toBe(false);

  await openPanel(page);
  await expect((await panelFrame(page)).locator('main')).toHaveAttribute('data-attach', 'attached');
  expect(await attachedDocument(serviceWorker, tabId)).not.toBe(first);
});

test('readiness baseline: shell visible and panel attached after a trigger', async ({
  context,
  server,
  openPanel,
  panelFrame,
}) => {
  const shell: number[] = [];
  const attached: number[] = [];
  for (let run = 0; run < 5; run++) {
    const page = await context.newPage();
    await page.goto(`${server.origin}/article.html?run=${run}`);
    await page.evaluate(() => {
      new MutationObserver((records, observer) => {
        if (records.some((record) => record.addedNodes.length > 0)) {
          (window as unknown as { shownAt: number }).shownAt = performance.now();
          observer.disconnect();
        }
      }).observe(document.documentElement, { childList: true });
    });
    const start = await page.evaluate(() => performance.now());
    await openPanel(page);
    const frame = await panelFrame(page);
    await expect(frame.locator('main')).toHaveAttribute('data-attach', 'attached');
    const end = await page.evaluate(() => performance.now());
    shell.push(
      (await page.evaluate(() => (window as unknown as { shownAt: number }).shownAt)) - start,
    );
    attached.push(end - start);
    await page.close();
  }
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[2] ?? NaN;
  test.info().annotations.push({
    type: 'readiness',
    description: `shell visible ${median(shell).toFixed(0)} ms, panel attached ${median(attached).toFixed(0)} ms (median of 5, including Playwright round trips)`,
  });
  console.log(test.info().annotations.at(-1)?.description);
  expect(median(shell)).toBeLessThan(1000);
});

interface E2EHook {
  __yipieE2E: { openPanel(tabId: number): Promise<void> };
}

interface ActionGlobal {
  chrome: {
    action: {
      getBadgeText(details: { tabId: number }): Promise<string>;
      getTitle(details: { tabId: number }): Promise<string>;
    };
  };
}

interface ScriptingGlobal {
  chrome: {
    scripting: {
      executeScript(injection: {
        target: { tabId: number };
        func: () => Promise<string>;
      }): Promise<{ result?: string }[]>;
    };
  };
}
