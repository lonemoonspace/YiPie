import type { BrowserContext, Frame, Page } from '@playwright/test';
import { NORMAL_ANSWER, REASONING, type RecordedRequest } from './fake-llm/llm';
import type { FakeServer } from './fake-llm/server';
import { expect, session, stored, test, useModel } from './fixtures';

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
  await frame.getByRole('button', { name: '复制' }).click();
  await expect(frame.getByRole('button', { name: '已复制' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(NORMAL_ANSWER.join(''));
});
