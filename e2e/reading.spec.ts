import type { BrowserContext, Frame, Page } from '@playwright/test';
import { expect, stored, test, useModel } from './fixtures';

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

  await frame.getByRole('button', { name: '复制正文' }).click();

  await expect(frame.getByRole('button', { name: '已复制' })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('一瞥是一个浏览器扩展');
});
