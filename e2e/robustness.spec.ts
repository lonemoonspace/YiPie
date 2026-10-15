import type { BrowserContext, Frame, Page } from '@playwright/test';
import { NORMAL_ANSWER, REASONING, type RecordedRequest } from './fake-llm/llm';
import type { FakeServer } from './fake-llm/server';
import {
  expect,
  openPanelWith,
  reloadExtension,
  session,
  stored,
  tabIdOf,
  test,
  useModel,
} from './fixtures';

/**
 * Phase 4 (docs/development-plan.md §4.5): what the panel does on its own when
 * a real-world service misbehaves.
 */

async function openOn(
  context: BrowserContext,
  server: FakeServer,
  openPanel: (page: Page) => Promise<void>,
  panelFrame: (page: Page) => Promise<Frame>,
) {
  const page = await context.newPage();
  await page.goto(`${server.origin}/article.html`);
  await openPanel(page);
  return { page, frame: await panelFrame(page) };
}

/** The hosts in the page, as the page sees them: children of <html> named yipie-panel-*. */
function hosts(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      [...document.documentElement.children].filter((element) =>
        element.tagName.toLowerCase().startsWith('yipie-panel-'),
      ).length,
  );
}

const requestsFor = (server: FakeServer, model: string): RecordedRequest[] =>
  server.requests.filter((request) => (request.body as { model?: unknown }).model === model);

test('a service that is busy at first gets the request once more, after the wait it asks for', async ({
  context,
  server,
  serviceWorker,
  openPanel,
  panelFrame,
}, testInfo) => {
  const model = `scenario:busy-once:${testInfo.testId}`;
  await useModel(serviceWorker, server, model);
  const { frame } = await openOn(context, server, openPanel, panelFrame);

  // The first answer is 429 with `Retry-After: 1`.
  await expect(frame.getByRole('status')).toHaveText('请求没有成功，1 秒后自动重试一次…');
  await expect(frame.locator('main')).toHaveAttribute('data-phase', 'done');
  await expect(frame.locator('article.answer')).toContainText('这篇文章介绍了');
  await expect(frame.getByRole('alert')).toHaveCount(0);
  expect(requestsFor(server, model)).toHaveLength(2);
});

test('a service that refuses stream_options gets the request again without it, and the model remembers', async ({
  context,
  server,
  serviceWorker,
  openPanel,
  panelFrame,
}) => {
  const model = 'scenario:no-stream-options';
  await useModel(serviceWorker, server, model);
  const before = requestsFor(server, model).length;
  const { frame } = await openOn(context, server, openPanel, panelFrame);

  await expect(frame.locator('main')).toHaveAttribute('data-phase', 'done');
  await expect(frame.locator('article.answer')).toContainText('这篇文章介绍了');
  const sent = requestsFor(server, model).slice(before);
  expect(sent.map((request) => 'stream_options' in (request.body as object))).toEqual([
    true,
    false,
  ]);

  // Remembered for the model, where the settings page shows it.
  await expect
    .poll(async () => {
      const models = (await stored(serviceWorker, 'model-configs')) as {
        data: { id: string; streamUsage: boolean }[];
      };
      return models.data.map(({ id, streamUsage }) => [id, streamUsage]);
    })
    .toEqual([['e2e', false]]);

  // The next request leaves it out from the start.
  await frame.getByRole('button', { name: '重新总结' }).click();
  await expect(frame.locator('main')).toHaveAttribute('data-phase', 'done');
  const next = requestsFor(server, model).slice(before + 2);
  expect(next.map((request) => 'stream_options' in (request.body as object))).toEqual([false]);
});

test('reasoning shows folded above the answer, and is never saved or copied', async ({
  context,
  server,
  serviceWorker,
  openPanel,
  panelFrame,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server.origin });
  await useModel(serviceWorker, server, 'scenario:reasoning');
  const { page, frame } = await openOn(context, server, openPanel, panelFrame);
  await expect(frame.locator('main')).toHaveAttribute('data-phase', 'done');

  const reasoning = frame.locator('details.reasoning');
  await expect(reasoning).not.toHaveAttribute('open');
  await expect(reasoning.locator('summary')).toHaveText('思考过程');
  await expect(reasoning.locator('p')).toHaveText(REASONING.join(''));
  await expect(frame.locator('article.answer')).not.toContainText('用户想要');

  // Saved without it.
  await expect
    .poll(async () => JSON.stringify(await session(serviceWorker)))
    .toContain('这篇文章介绍了');
  expect(JSON.stringify(await session(serviceWorker))).not.toContain(REASONING[0]);

  // Copied without it.
  await frame.getByRole('button', { name: '复制', exact: true }).click();
  await expect(frame.getByRole('button', { name: '已复制', exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(NORMAL_ANSWER.join(''));
});

test('after the extension is updated, triggering again mounts a working panel over no old host', async ({
  context,
  server,
  serviceWorker,
  openPanel,
  panelFrame,
}) => {
  await useModel(serviceWorker, server, 'scenario:normal');
  const { page, frame } = await openOn(context, server, openPanel, panelFrame);
  await expect(frame.locator('main')).toHaveAttribute('data-phase', 'done');
  const tabId = await tabIdOf(serviceWorker, page);

  // The update: the old content script and its host stay in the page, cut off.
  const worker = await reloadExtension(context, serviceWorker);
  expect(await hosts(page)).toBe(1);

  const before = server.requests.length;
  await openPanelWith(worker, tabId);

  await expect.poll(() => hosts(page)).toBe(1);
  const fresh = await panelFrame(page);
  await expect(fresh.locator('main')).toHaveAttribute('data-phase', 'done');
  // A new summary: the new content script reads the page again.
  expect(server.requests).toHaveLength(before + 1);
  expect(await hosts(page)).toBe(1);
});

test('a host cut off by an update removes itself once the page is in view again', async ({
  context,
  server,
  serviceWorker,
  openPanel,
  panelFrame,
}) => {
  await useModel(serviceWorker, server, 'scenario:normal');
  const { page, frame } = await openOn(context, server, openPanel, panelFrame);
  await expect(frame.locator('main')).toHaveAttribute('data-phase', 'done');

  await reloadExtension(context, serviceWorker);
  expect(await hosts(page)).toBe(1);

  // What the browser sends when the user comes back to the tab.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

  await expect.poll(() => hosts(page)).toBe(0);
});

/**
 * Plants a host as the previous version leaves one: it puts itself back
 * after it is removed, `tries` times (phase 3 gives up after 5 a minute).
 */
function plantLeftoverHost(page: Page, tries: number) {
  return page.evaluate((limit) => {
    const ghost = document.createElement('yipie-panel-0123abcd');
    ghost.setAttribute('data-yipie-host', '');
    document.documentElement.append(ghost);
    let count = 0;
    new MutationObserver(() => {
      if (ghost.isConnected || count >= limit) return;
      count += 1;
      document.documentElement.append(ghost);
    }).observe(document.documentElement, { childList: true });
  }, tries);
}

test('a host the previous version left gives way to the new one, however it fights back', async ({
  context,
  server,
  serviceWorker,
  openPanel,
  panelFrame,
}) => {
  await useModel(serviceWorker, server, 'scenario:normal');
  const page = await context.newPage();
  await page.goto(`${server.origin}/article.html`);
  await plantLeftoverHost(page, 5);

  await openPanel(page);

  await expect((await panelFrame(page)).locator('main')).toHaveAttribute('data-phase', 'done');
  await expect.poll(() => hosts(page)).toBe(1);
});

test('a page that keeps putting such a host back is left alone, and the panel still works', async ({
  context,
  server,
  serviceWorker,
  openPanel,
  panelFrame,
}) => {
  await useModel(serviceWorker, server, 'scenario:normal');
  const page = await context.newPage();
  await page.goto(`${server.origin}/article.html`);
  await plantLeftoverHost(page, Number.POSITIVE_INFINITY);

  await openPanel(page);

  await expect((await panelFrame(page)).locator('main')).toHaveAttribute('data-phase', 'done');
  // We stopped removing it; the page goes on as it likes.
  expect(await hosts(page)).toBe(2);
});

test("the page's own elements that only look like a host are never removed", async ({
  context,
  server,
  serviceWorker,
  openPanel,
  panelFrame,
}) => {
  await useModel(serviceWorker, server, 'scenario:normal');
  const page = await context.newPage();
  await page.goto(`${server.origin}/article.html`);
  // The same tag names as a host, without the marker; and a marker on a
  // name a host never has.
  await page.evaluate(() => {
    for (const [tag, marked] of [
      ['yipie-panel-0123abcd', false],
      ['yipie-panel-widget', false],
      ['yipie-panel-widget', true],
    ] as const) {
      const element = document.createElement(tag);
      element.className = 'page-own';
      if (marked) element.setAttribute('data-yipie-host', '');
      document.documentElement.append(element);
    }
  });

  await openPanel(page);
  await expect((await panelFrame(page)).locator('main')).toHaveAttribute('data-phase', 'done');

  expect(await page.locator('html > .page-own').count()).toBe(3);
  expect(await hosts(page)).toBe(4);
});
