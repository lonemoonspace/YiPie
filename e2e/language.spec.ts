import type { Page, Worker } from '@playwright/test';
import { expect, storeSettings, stored, tabIdOf, test, useModel } from './fixtures';

const optionsUrl = (extensionId: string) => `chrome-extension://${extensionId}/options.html`;

interface ActionGlobal {
  chrome: { action: { getTitle(details: { tabId: number }): Promise<string> } };
}

/** The icon's title in `page`'s tab after a trigger on a page we may not script. */
async function unavailableTitle(serviceWorker: Worker, page: Page): Promise<string> {
  const tabId = await tabIdOf(serviceWorker, page);
  await page.goto('about:blank');
  await serviceWorker.evaluate(
    (id) =>
      (
        globalThis as unknown as { __yipieE2E: { openPanel(id: number): Promise<void> } }
      ).__yipieE2E.openPanel(id),
    tabId,
  );
  return serviceWorker.evaluate(
    (id) => (globalThis as unknown as ActionGlobal).chrome.action.getTitle({ tabId: id }),
    tabId,
  );
}

test('switching the interface to English changes the settings page, the panel and the worker', async ({
  context,
  server,
  serviceWorker,
  extensionId,
  openPanel,
  panelFrame,
}) => {
  await useModel(serviceWorker, server, 'scenario:normal');
  const settings = await context.newPage();
  await settings.goto(optionsUrl(extensionId));
  await expect(settings.locator('html')).toHaveAttribute('lang', 'zh-CN');

  await settings.getByLabel('界面语言').selectOption('en');

  // The page renders afresh in English; the choice is stored by the background.
  await expect(settings.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await expect(settings.locator('html')).toHaveAttribute('lang', 'en');
  await expect(settings.getByLabel('Interface language')).toHaveValue('en');
  await expect
    .poll(() => stored(serviceWorker, 'general-settings'))
    .toMatchObject({ version: 1, data: { interfaceLanguage: 'en' } });
  await expect(settings).toHaveTitle('YiPie · Settings');
  // A new prompt starts from the English templates.
  await settings.getByRole('button', { name: 'Add a prompt' }).click();
  await expect(settings.getByLabel('User template')).toHaveValue(/^<page>\nTitle: \{\{title\}\}/);

  // Still English after a reload.
  await settings.reload();
  await expect(settings.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();

  // The panel speaks it, and the built-in prompt (never stored) is the English one.
  const page = await context.newPage();
  await page.goto(`${server.origin}/article.html`);
  await openPanel(page);
  const frame = await panelFrame(page);
  await expect(frame.locator('main')).toHaveAttribute('data-phase', 'done');
  await expect(frame.getByRole('status')).toHaveText('Done');
  await expect(frame.getByRole('button', { name: 'Summarize again' })).toBeVisible();
  await expect(frame.locator('html')).toHaveAttribute('lang', 'en');
  const messages = (server.requests.at(-1)?.body as { messages: { content: string }[] }).messages;
  expect(messages[0]?.content).toContain('Write an easy-to-scan Markdown summary in English');
  expect(messages[1]?.content).toContain(`Address: ${server.origin}/article.html`);

  // So does the worker, for what it shows itself.
  expect(await unavailableTitle(serviceWorker, page)).toBe('This page cannot be summarized');
});

test('an open panel follows a change of language', async ({
  context,
  server,
  serviceWorker,
  extensionId,
  openPanel,
  panelFrame,
}) => {
  await useModel(serviceWorker, server, 'scenario:normal');
  const page = await context.newPage();
  await page.goto(`${server.origin}/article.html`);
  await openPanel(page);
  const frame = await panelFrame(page);
  await expect(frame.getByRole('status')).toHaveText('完成');
  await expect(frame.getByRole('button', { name: '复制', exact: true })).toBeVisible();

  const settings = await context.newPage();
  await settings.goto(optionsUrl(extensionId));
  await settings.getByLabel('界面语言').selectOption('en');

  await expect(frame.getByRole('status')).toHaveText('Done');
  // The finished answer's own buttons too.
  await expect(frame.getByRole('button', { name: 'Copy', exact: true })).toBeVisible();
});

test.describe('in an English browser', () => {
  test.use({ browserLanguage: 'en-US' });

  test('the interface is English until the settings name another language', async ({
    context,
    server,
    serviceWorker,
    extensionId,
  }) => {
    const settings = await context.newPage();
    await settings.goto(optionsUrl(extensionId));
    await expect(settings.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    await expect(settings.getByLabel('Interface language')).toHaveValue('auto');
    const page = await context.newPage();
    await page.goto(`${server.origin}/article.html`);
    expect(await unavailableTitle(serviceWorker, page)).toBe('This page cannot be summarized');

    await storeSettings(serviceWorker, { interfaceLanguage: 'zh-Hans' });

    // The open page and the worker follow the stored change.
    await expect(settings.getByRole('heading', { name: '设置', level: 1 })).toBeVisible();
    await expect
      .poll(async () => {
        const again = await context.newPage();
        await again.goto(`${server.origin}/article.html`);
        return unavailableTitle(serviceWorker, again);
      })
      .toBe('此页面无法总结');
  });
});
