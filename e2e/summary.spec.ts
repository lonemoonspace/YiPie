import type { BrowserContext, Frame, Page } from '@playwright/test';
import type { RecordedRequest } from './fake-llm/llm';
import type { FakeServer } from './fake-llm/server';
import {
  E2E_KEY as KEY,
  expect,
  storeModels,
  storePrompts,
  stored,
  test,
  useModel,
} from './fixtures';

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
  await expect(alert).toContainText('鉴权失败：请检查 API Key');
  await expect(alert).toContainText('服务返回 HTTP 401：Incorrect API key provided: ***');
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
  await expect(frame.getByRole('alert')).toContainText('服务出错了，可能是暂时的');
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

test('the default prompt shapes the request, unknown placeholders included', async ({
  context,
  server,
  serviceWorker,
  openPanel,
  panelFrame,
}) => {
  await useModel(serviceWorker, server, 'scenario:normal');
  await storePrompts(serviceWorker, [
    { id: 'mine', name: '我的', system: '', user: '标题：{{title}}；{{ foo }}\n{{content}}' },
  ]);

  const { frame } = await openOn(context, server, openPanel, panelFrame);
  await expect(frame.locator('main')).toHaveAttribute('data-phase', 'done');

  // A blank system template sends no system message.
  const messages = (lastRequest(server)?.body as { messages: { role: string; content: string }[] })
    .messages;
  expect(messages.map((message) => message.role)).toEqual(['user']);
  expect(messages[0]?.content).toMatch(/^标题：一篇普通的文章；\{\{ foo \}\}\n/);
  expect(messages[0]?.content).toContain('一瞥是一个浏览器扩展');
});

test('without a prompt the panel says how to fix it', async ({
  context,
  server,
  serviceWorker,
  openPanel,
  panelFrame,
}) => {
  await useModel(serviceWorker, server, 'scenario:normal');
  await storePrompts(serviceWorker, []);
  const before = server.requests.length;

  const { frame } = await openOn(context, server, openPanel, panelFrame);

  await expect(frame.locator('main')).toHaveAttribute('data-problem', 'no-prompt');
  await expect(frame.getByRole('alert')).toContainText('还没有 Prompt');
  await expect(frame.getByRole('button', { name: '打开设置' })).toBeVisible();
  expect(server.requests).toHaveLength(before);
});

test('the model menu makes another model the default and summarizes again with it', async ({
  context,
  server,
  serviceWorker,
  openPanel,
  panelFrame,
}) => {
  await storeModels(serviceWorker, server, [
    { id: 'main', name: '主力', model: 'scenario:slow' },
    { id: 'spare', name: '备用', model: 'scenario:normal' },
  ]);
  const { frame } = await openOn(context, server, openPanel, panelFrame);
  const menu = frame.getByRole('combobox', { name: '模型' });

  await expect(menu).toHaveValue('main');
  await expect(frame.locator('article.answer')).toContainText('片段2');
  const slow = lastRequest(server);
  expect((slow?.body as { model: string }).model).toBe('scenario:slow');

  await menu.selectOption({ label: '备用' });

  // The slow answer is dropped and its request ended; the new model answers.
  await expect(frame.locator('main')).toHaveAttribute('data-phase', 'done');
  await expect(frame.locator('article.answer h2')).toHaveText('概要');
  await expect(frame.locator('article.answer')).not.toContainText('片段');
  await expect.poll(() => slow?.aborted).toBe(true);
  expect((lastRequest(server)?.body as { model: string }).model).toBe('scenario:normal');
  await expect(menu).toHaveValue('spare');

  // The menu wrote the global default, which the next trigger uses too.
  expect(await stored(serviceWorker, 'selection')).toEqual({
    version: 1,
    data: { defaultModelId: 'spare', defaultPromptId: null },
  });
});

test('the model menu switches between the model names a configuration lists', async ({
  context,
  server,
  serviceWorker,
  openPanel,
  panelFrame,
}) => {
  await storeModels(serviceWorker, server, [
    {
      id: 'main',
      name: '主力',
      model: 'scenario:slow',
      menuModels: ['scenario:slow', 'scenario:normal'],
    },
    { id: 'spare', name: '备用', model: 'scenario:chat' },
  ]);
  const { frame } = await openOn(context, server, openPanel, panelFrame);
  const menu = frame.getByRole('combobox', { name: '模型' });

  // Grouped by configuration, each listing its model names.
  await expect(menu.locator('optgroup')).toHaveCount(2);
  await expect(menu.locator('optgroup[label="主力"] option')).toHaveText([
    'scenario:slow',
    'scenario:normal',
  ]);
  await expect(menu).toHaveAttribute('title', '主力 · scenario:slow');
  await expect(frame.locator('article.answer')).toContainText('片段2');

  await menu.selectOption({ label: 'scenario:normal' });

  await expect(frame.locator('main')).toHaveAttribute('data-phase', 'done');
  await expect(frame.locator('article.answer h2')).toHaveText('概要');
  expect((lastRequest(server)?.body as { model: string }).model).toBe('scenario:normal');
  await expect(menu).toHaveAttribute('title', '主力 · scenario:normal');

  // The pick is the configuration's model now, and both names stay on its menu.
  const models = (await stored(serviceWorker, 'model-configs')) as {
    data: { id: string; model: string; menuModels: string[] }[];
  };
  expect(models.data[0]).toMatchObject({
    id: 'main',
    model: 'scenario:normal',
    menuModels: ['scenario:slow', 'scenario:normal'],
  });
});

test('the prompt menu makes another built-in prompt the default and starts over with it', async ({
  context,
  server,
  serviceWorker,
  openPanel,
  panelFrame,
}) => {
  await useModel(serviceWorker, server, 'scenario:chat');
  const { frame } = await openOn(context, server, openPanel, panelFrame);
  await expect(frame.locator('main')).toHaveAttribute('data-phase', 'done');
  const menu = frame.getByRole('combobox', { name: 'Prompt' });
  await expect(menu).toHaveValue('builtin-summary');
  const systemOf = (request: RecordedRequest | undefined) =>
    (request?.body as { messages: { content: string }[] }).messages[0]?.content ?? '';
  expect(systemOf(lastRequest(server))).toContain('便于快速阅读');

  await frame.getByRole('textbox', { name: '追问' }).fill('问一句');
  await frame.getByRole('textbox', { name: '追问' }).press('Enter');
  await expect(frame.locator('.question')).toHaveCount(1);
  await expect(frame.locator('main')).toHaveAttribute('data-phase', 'done');
  const before = server.requests.length;

  await menu.selectOption({ label: '速读' });

  // A new summary with the quick read: the follow-up is gone, nothing else is sent.
  await expect.poll(() => server.requests.length).toBe(before + 1);
  await expect(frame.locator('main')).toHaveAttribute('data-phase', 'done');
  await expect(frame.locator('.question')).toHaveCount(0);
  expect(systemOf(lastRequest(server))).toContain('30 秒能读完');
  expect((lastRequest(server)?.body as { messages: unknown[] }).messages).toHaveLength(2);
  await expect(menu).toHaveValue('builtin-quick');

  // The menu wrote the global default, which the next trigger uses too.
  expect(await stored(serviceWorker, 'selection')).toMatchObject({
    version: 1,
    data: { defaultPromptId: 'builtin-quick' },
  });
});

test('with summarizing on opening turned off, the panel waits for the user to ask', async ({
  context,
  extensionId,
  server,
  serviceWorker,
  openPanel,
  panelFrame,
}) => {
  await useModel(serviceWorker, server, 'scenario:normal');
  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${extensionId}/options.html`);
  await settings.getByLabel('打开面板时自动总结').uncheck();
  await expect(settings.getByRole('region', { name: '通用' }).getByRole('status')).toHaveText(
    '已保存',
  );
  expect(await stored(serviceWorker, 'general-settings')).toMatchObject({
    data: { autoSummarize: false },
  });
  const before = server.requests.length;

  const { frame } = await openOn(context, server, openPanel, panelFrame);

  await expect(frame.locator('main')).toHaveAttribute('data-phase', 'ready');
  await expect(frame.getByRole('status')).toHaveText('点「总结此页」开始');
  await expect(frame.getByRole('combobox', { name: '模型' })).toBeVisible();
  expect(server.requests).toHaveLength(before);

  await frame.getByRole('button', { name: '总结此页' }).click();
  await expect(frame.locator('main')).toHaveAttribute('data-phase', 'done');
  await expect(frame.locator('article.answer')).toContainText('这篇文章介绍了');
  expect(server.requests).toHaveLength(before + 1);
});
