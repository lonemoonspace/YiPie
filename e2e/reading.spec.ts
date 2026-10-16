import type { BrowserContext, Frame, Page } from '@playwright/test';
import { SHADOW_TEXT } from './fake-llm/pages';
import { expect, openPanelOnSelection, session, stored, tabIdOf, test, useModel } from './fixtures';

async function open(
  context: BrowserContext,
  url: string,
  openPanel: (page: Page) => Promise<void>,
  panelFrame: (page: Page) => Promise<Frame>,
) {
  const page = await context.newPage();
  await page.goto(url);
  await openPanel(page);
  return { page, frame: await panelFrame(page) };
}

test('theme and reading size chosen in the settings hold after a reload, in the panel too', async ({
  context,
  server,
  serviceWorker,
  extensionId,
  openPanel,
  panelFrame,
}) => {
  await useModel(serviceWorker, server, 'scenario:normal');
  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${extensionId}/options.html`);
  await settings.getByLabel('主题').selectOption('dark');
  await expect(settings.getByRole('status').filter({ hasText: '已保存' })).toBeVisible();
  await settings.getByLabel('面板字号').selectOption('x-large');
  await expect(settings.getByRole('status').filter({ hasText: '已保存' })).toBeVisible();

  await settings.reload();
  await expect(settings.getByLabel('主题')).toHaveValue('dark');
  await expect(settings.getByLabel('面板字号')).toHaveValue('x-large');
  await expect(settings.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await stored(serviceWorker, 'general-settings')).toMatchObject({
    data: { theme: 'dark', fontSize: 'x-large' },
  });

  const { frame } = await open(context, `${server.origin}/article.html`, openPanel, panelFrame);
  await expect(frame.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(frame.locator('html')).toHaveAttribute('data-font-size', 'x-large');
  expect(await frame.locator('body').evaluate((body) => getComputedStyle(body).fontSize)).toBe(
    '18px',
  );

  // A change made while the panel is open reaches it.
  await settings.getByLabel('面板字号').selectOption('small');
  await expect(frame.locator('html')).toHaveAttribute('data-font-size', 'small');
});

test('the page text the extension read can be copied from the panel', async ({
  context,
  server,
  serviceWorker,
  openPanel,
  panelFrame,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server.origin });
  await useModel(serviceWorker, server, 'scenario:normal');
  const { page, frame } = await open(
    context,
    `${server.origin}/article.html`,
    openPanel,
    panelFrame,
  );
  await expect(frame.locator('main')).toHaveAttribute('data-phase', 'done');

  // Kept behind "⋯", with opening the settings.
  await frame.getByRole('button', { name: '更多', exact: true }).click();
  await frame.getByRole('button', { name: '复制正文' }).click();

  await expect(frame.getByRole('button', { name: '已复制' })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('一瞥是一个浏览器扩展');
});

test('text that only an open shadow root holds is read and sent', async ({
  context,
  server,
  serviceWorker,
  openPanel,
  panelFrame,
}) => {
  await useModel(serviceWorker, server, 'scenario:normal');
  const { frame } = await open(context, `${server.origin}/shadow.html`, openPanel, panelFrame);
  await expect(frame.locator('main')).toHaveAttribute('data-phase', 'done');

  const sent = JSON.stringify(server.requests.at(-1)?.body);
  expect(sent).toContain(SHADOW_TEXT);
  expect(sent).not.toContain('首页');
});

interface Message {
  role: string;
  content: string;
}

const lastUserMessage = (body: unknown) =>
  ((body as { messages?: Message[] } | undefined)?.messages ?? []).at(-1)?.content ?? '';

/** Selects the text of the paragraph that contains `text`. */
async function select(page: Page, text: string) {
  await page.evaluate((needle) => {
    const paragraph = [...document.querySelectorAll('p')].find((p) =>
      p.textContent?.includes(needle),
    );
    if (!paragraph) throw new Error(`No paragraph with ${needle}`);
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
  }, text);
}

test('the selection is summarized on its own, and the page keeps its conversation', async ({
  context,
  server,
  serviceWorker,
  openPanel,
  panelFrame,
}) => {
  await useModel(serviceWorker, server, 'scenario:normal');
  const { page, frame } = await open(
    context,
    `${server.origin}/article.html`,
    openPanel,
    panelFrame,
  );
  await expect(frame.locator('main')).toHaveAttribute('data-phase', 'done');
  const savedBefore = await session(serviceWorker);

  await select(page, '浮动面板');
  await openPanelOnSelection(serviceWorker, page);
  // A new panel replaces the open one; Playwright may still list the old frame for a moment.
  await expect.poll(() => frame.isDetached()).toBe(true);
  const selection = await panelFrame(page);
  await expect(selection.locator('main')).toHaveAttribute('data-phase', 'done');

  const sent = lastUserMessage(server.requests.at(-1)?.body);
  expect(sent).toContain('它在页面里打开一个浮动面板');
  expect(sent).not.toContain('一瞥是一个浏览器扩展');
  await expect(selection.locator('[data-mode="selection"]')).toContainText('选中的内容');
  // Nothing was saved for the selection: the page's conversation is as it was.
  const savedAfter = await session(serviceWorker);
  const snapshots = (all: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(all).filter(([key]) => key.startsWith('snapshot')));
  expect(snapshots(savedAfter)).toEqual(snapshots(savedBefore));
});

test('the menu-reported selection stands in when the page reads none', async ({
  context,
  server,
  serviceWorker,
  panelFrame,
}) => {
  await useModel(serviceWorker, server, 'scenario:normal');
  const page = await context.newPage();
  await page.goto(`${server.origin}/article.html`);

  await openPanelOnSelection(serviceWorker, page, '菜单报告的选中文字');
  const frame = await panelFrame(page);
  await expect(frame.locator('main')).toHaveAttribute('data-phase', 'done');

  expect(lastUserMessage(server.requests.at(-1)?.body)).toContain('菜单报告的选中文字');
});

test('a quote in the answer finds its passage in the page, without changing the page', async ({
  context,
  server,
  serviceWorker,
  openPanel,
  panelFrame,
}) => {
  await useModel(serviceWorker, server, 'scenario:cite');
  const { page, frame } = await open(
    context,
    `${server.origin}/article.html`,
    openPanel,
    panelFrame,
  );
  await expect(frame.locator('main')).toHaveAttribute('data-phase', 'done');
  const before = await page.evaluate(() => document.body.innerHTML);

  await frame.getByRole('button', { name: '在网页中定位引用 1' }).click();

  const tabId = await tabIdOf(serviceWorker, page);
  // The highlight lives in the content script's world, where it was made.
  const highlighted = () =>
    serviceWorker.evaluate(async (id) => {
      const { chrome } = globalThis as unknown as {
        chrome: {
          scripting: {
            executeScript(options: object): Promise<{ result?: unknown }[]>;
          };
        };
      };
      const [frameResult] = await chrome.scripting.executeScript({
        target: { tabId: id },
        func: () => {
          const highlight = CSS.highlights.get('yipie-quote');
          return highlight ? [...highlight].map((range) => (range as Range).toString()) : [];
        },
      });
      return frameResult?.result;
    }, tabId);
  await expect.poll(highlighted).toEqual(['它在页面里打开一个浮动面板']);
  expect(await page.evaluate(() => document.body.innerHTML)).toBe(before);

  await frame.getByRole('button', { name: '在网页中定位引用 2' }).click();
  await expect(frame.locator('[data-located]')).toContainText(
    '在网页里没找到这段原文：这句话页面上没有',
  );
  await expect.poll(highlighted).toEqual([]);
});
