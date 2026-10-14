import type { BrowserContext, Frame, Page, Worker } from '@playwright/test';
import type { RecordedRequest } from './fake-llm/llm';
import type { FakeServer } from './fake-llm/server';
import { expect, test, type ChromeStorageGlobal } from './fixtures';

const KEY = 'sk-e2e-not-a-real-key';

/** Stores one model configuration pointing at the fake service, as the settings page would. */
async function useModel(serviceWorker: Worker, server: FakeServer, model: string) {
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
    { baseURL: `${server.origin}/v1`, model, key: KEY },
  );
}

interface Opened {
  page: Page;
  frame: Frame;
}

async function openOn(
  context: BrowserContext,
  server: FakeServer,
  openPanel: (page: Page) => Promise<void>,
  panelFrame: (page: Page) => Promise<Frame>,
): Promise<Opened> {
  const page = await context.newPage();
  await page.goto(`${server.origin}/article.html`);
  await openPanel(page);
  return { page, frame: await panelFrame(page) };
}

const lastRequest = (server: FakeServer): RecordedRequest | undefined => server.requests.at(-1);

test('the page is summarized and the answer streams into the panel', async ({
  context,
  server,
  serviceWorker,
  extensionId,
  openPanel,
  panelFrame,
}) => {
  await useModel(serviceWorker, server, 'scenario:normal');
  const before = server.requests.length;

  const { frame } = await openOn(context, server, openPanel, panelFrame);

  await expect(frame.locator('main')).toHaveAttribute('data-phase', 'done');
  await expect(frame.getByRole('status')).toHaveText('完成');
  const answer = frame.locator('article.answer');
  await expect(answer.locator('h2')).toHaveText('概要');
  await expect(answer).toContainText(
    '这篇文章介绍了一瞥：一个用你自己的模型总结网页的浏览器扩展。',
  );
  await expect(answer.locator('li')).toHaveCount(2);

  // What reached the service: the protocol's fields, the page, the key.
  expect(server.requests).toHaveLength(before + 1);
  const request = lastRequest(server);
  expect(request?.authorization).toBe(`Bearer ${KEY}`);
  expect(request?.origin).toBe(`chrome-extension://${extensionId}`);
  const body = request?.body as Record<string, unknown>;
  expect(body).toMatchObject({
    model: 'scenario:normal',
    stream: true,
    stream_options: { include_usage: true },
  });
  expect(body).not.toHaveProperty('temperature');
  expect(body).not.toHaveProperty('max_tokens');
  const messages = body.messages as { role: string; content: string }[];
  expect(messages.map((message) => message.role)).toEqual(['system', 'user']);
  expect(messages[1]?.content).toContain('一瞥是一个浏览器扩展');
  expect(messages[1]?.content).toContain(`地址：${server.origin}/article.html`);
});

test('the answer appears as it streams, and stopping keeps what arrived', async ({
  context,
  server,
  serviceWorker,
  openPanel,
  panelFrame,
}) => {
  await useModel(serviceWorker, server, 'scenario:slow');
  const { frame } = await openOn(context, server, openPanel, panelFrame);
  const answer = frame.locator('article.answer');

  await expect(answer).toContainText('片段3');
  await expect(frame.locator('main')).toHaveAttribute('data-phase', 'streaming');
  await frame.getByRole('button', { name: '停止' }).click();

  await expect(frame.locator('main')).toHaveAttribute('data-phase', 'stopped');
  await expect(frame.getByRole('status')).toHaveText('已停止');
  await expect(answer).toContainText('片段3');
  await expect(answer).not.toContainText('片段40');
  await expect.poll(() => lastRequest(server)?.aborted).toBe(true);
  await expect(frame.getByRole('button', { name: '重新总结' })).toBeVisible();
});

test('closing the panel mid-answer ends the request', async ({
  context,
  server,
  serviceWorker,
  openPanel,
  panelFrame,
}) => {
  await useModel(serviceWorker, server, 'scenario:slow');
  const { page, frame } = await openOn(context, server, openPanel, panelFrame);
  await expect(frame.locator('article.answer')).toContainText('片段2');

  // The close button sits at the right end of the shell's title bar.
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  await page.mouse.click(viewport.width - 16 - 19, 16 + 17);

  await expect.poll(() => lastRequest(server)?.aborted).toBe(true);
  expect(page.frames().some((candidate) => candidate.url().includes('/panel.html'))).toBe(false);
});

test('retrying sends a new request and replaces the answer', async ({
  context,
  server,
  serviceWorker,
  openPanel,
  panelFrame,
}) => {
  await useModel(serviceWorker, server, 'scenario:normal');
  const { frame } = await openOn(context, server, openPanel, panelFrame);
  await expect(frame.locator('main')).toHaveAttribute('data-phase', 'done');
  const before = server.requests.length;

  await frame.getByRole('button', { name: '重新总结' }).click();

  await expect(frame.locator('main')).toHaveAttribute('data-phase', 'done');
  expect(server.requests).toHaveLength(before + 1);
  await expect(frame.locator('article.answer h2')).toHaveCount(1);
});

test('without a model configuration the panel says how to fix it', async ({
  context,
  server,
  openPanel,
  panelFrame,
}) => {
  const { frame } = await openOn(context, server, openPanel, panelFrame);

  await expect(frame.locator('main')).toHaveAttribute('data-phase', 'error');
  await expect(frame.getByRole('alert')).toContainText('还没有配置模型');
  await expect(frame.getByRole('button', { name: '打开设置' })).toBeVisible();
});

test('an authentication error is explained, and the key is never shown', async ({
  context,
  server,
  serviceWorker,
  openPanel,
  panelFrame,
}) => {
  await useModel(serviceWorker, server, 'scenario:unauthorized');
  const { frame } = await openOn(context, server, openPanel, panelFrame);

  const alert = frame.getByRole('alert');
  await expect(alert).toContainText('鉴权失败（HTTP 401）');
  await expect(alert).toContainText('服务返回：Incorrect API key provided: ***');
  await expect(alert).not.toContainText(KEY);
  await expect(frame.getByRole('button', { name: '打开设置' })).toBeVisible();
});

test('an error inside the stream keeps the text that came before it', async ({
  context,
  server,
  serviceWorker,
  openPanel,
  panelFrame,
}) => {
  await useModel(serviceWorker, server, 'scenario:stream-error');
  const { frame } = await openOn(context, server, openPanel, panelFrame);

  await expect(frame.locator('main')).toHaveAttribute('data-phase', 'error');
  await expect(frame.locator('article.answer')).toHaveText('先输出一点');
  await expect(frame.getByRole('alert')).toContainText('服务在输出过程中报告了错误。');
  await expect(frame.getByRole('alert')).toContainText('Upstream overloaded');
});

test('model output cannot inject markup or make the panel fetch images', async ({
  context,
  server,
  serviceWorker,
  openPanel,
  panelFrame,
}) => {
  await useModel(serviceWorker, server, 'scenario:unsafe');
  const { frame } = await openOn(context, server, openPanel, panelFrame);
  await expect(frame.locator('main')).toHaveAttribute('data-phase', 'done');

  const answer = frame.locator('article.answer');
  await expect(answer.locator('img')).toHaveCount(0);
  await expect(answer).toContainText('<img src=x onerror="document.title=1">');
  await expect(answer).toContainText('追踪像素');
  await expect(answer.locator('a')).toHaveCount(1);
  await expect(answer.locator('a')).toHaveAttribute('href', 'https://example.com/ok');
  expect(await frame.evaluate(() => document.title)).toBe('一瞥');
});
