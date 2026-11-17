import type { Page } from '@playwright/test';
import { E2E_KEY, expect, storeModels, stored, test } from './fixtures';

/** The first-run page (docs/development-plan.md §4.8). */
const welcomeUrl = (extensionId: string, path = '') =>
  `chrome-extension://${extensionId}/options.html#welcome${path === '' ? '' : `/${path}`}`;

interface StoredList {
  version: number;
  data: { id: string; name: string; baseURL: string; apiKey: string; model: string }[];
}

test('installing the extension opens the first-run page, once', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const welcome = () => context.pages().filter((page) => page.url() === welcomeUrl(extensionId));
  await expect.poll(() => welcome().length).toBe(1);
  const page = welcome()[0] as Page;
  await expect(page.getByRole('heading', { name: '欢迎使用' })).toBeVisible();
  await expect(page.getByRole('button', { name: /我有 API Key/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /先免费试用/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /用本机模型/ })).toBeVisible();
  // Nothing is asked of the browser until a way in is chosen.
  expect(await stored(serviceWorker, 'model-configs')).toBeUndefined();
});

test('with a key: list the models, pick one for the user, test and save it as the default', async ({
  context,
  extensionId,
  serviceWorker,
  server,
}) => {
  // A model from before: the new one still becomes the default.
  await storeModels(serviceWorker, server, [{ id: 'old', name: '旧的', model: 'scenario:chat' }]);
  const page = await context.newPage();
  await page.goto(welcomeUrl(extensionId, 'key'));
  await expect(page.getByRole('button', { name: /我有 API Key/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.getByRole('radio', { name: '其他（自己填地址）' }).check();
  await page.getByLabel('Base URL').fill(`${server.origin}/v1`);
  await page.getByLabel('API Key').fill(E2E_KEY);
  await page.getByRole('button', { name: '连接并列出模型' }).click();
  await expect(page.getByText('连接成功：服务列出了 3 个模型，已为你选好一个。')).toBeVisible();
  // The first chat model on the list, in order.
  await expect(page.getByLabel('模型', { exact: true })).toHaveValue('scenario:chat');

  await page.getByLabel('模型', { exact: true }).selectOption('scenario:normal');
  await page.getByRole('button', { name: '测试并保存' }).click();
  await expect(page.getByRole('heading', { name: '设置好了：scenario:normal' })).toBeVisible();

  const models = (await stored(serviceWorker, 'model-configs')) as StoredList;
  expect(models.data).toHaveLength(2);
  expect(models.data[1]).toMatchObject({
    baseURL: `${server.origin}/v1`,
    apiKey: E2E_KEY,
    model: 'scenario:normal',
  });
  expect(await stored(serviceWorker, 'selection')).toMatchObject({
    data: { defaultModelId: models.data[1]?.id },
  });
});

test('with a key: a failed test says why and still lets the user save', async ({
  context,
  extensionId,
  serviceWorker,
  server,
}) => {
  const page = await context.newPage();
  await page.goto(welcomeUrl(extensionId, 'key'));
  await page.getByRole('radio', { name: '其他（自己填地址）' }).check();
  await page.getByLabel('Base URL').fill(`${server.origin}/no-models/v1`);
  await page.getByRole('button', { name: '连接并列出模型' }).click();
  await expect(page.getByText(/服务没有提供模型列表/)).toBeVisible();
  await page.getByLabel('模型名').fill('scenario:unauthorized');
  await page.getByRole('button', { name: '测试并保存' }).click();
  await expect(page.getByText(/连接失败：鉴权失败/)).toBeVisible();
  expect(await stored(serviceWorker, 'model-configs')).toBeUndefined();

  await page.getByRole('button', { name: '仍然保存' }).click();
  await expect(
    page.getByRole('heading', { name: '设置好了：scenario:unauthorized' }),
  ).toBeVisible();
  expect(((await stored(serviceWorker, 'model-configs')) as StoredList).data).toHaveLength(1);
});

test('the free path lists services with a key link each, and no address field', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(welcomeUrl(extensionId, 'free'));
  const services = page.getByRole('group', { name: '选择一个有免费额度的服务' });
  await expect(services.getByRole('radio')).toHaveCount(5);
  await expect(page.getByText(/这份名单整理于 2026 年 11 月/)).toBeVisible();
  await expect(page.getByRole('link', { name: /去 智谱 申请/ })).toHaveAttribute(
    'href',
    /^https:\/\/bigmodel\.cn\//,
  );
  await expect(page.getByLabel('Base URL')).toHaveCount(0);
});

test('the settings page points to the first-run page while there is no model', async ({
  context,
  extensionId,
  serviceWorker,
  server,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.getByRole('link', { name: '打开新手引导' }).click();
  await expect(page.getByRole('heading', { name: '欢迎使用' })).toBeVisible();
  await page.getByRole('link', { name: '打开完整设置' }).click();
  await expect(page.getByRole('heading', { name: '设置' })).toBeVisible();

  await storeModels(serviceWorker, server, [{ id: 'e2e', name: '', model: 'scenario:normal' }]);
  await page.reload();
  await expect(page.getByRole('region', { name: '模型' }).getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('link', { name: '打开新手引导' })).toHaveCount(0);
});

test('a panel with no model offers the three ways in, and summarizes once a model is set up', async ({
  context,
  extensionId,
  serviceWorker,
  server,
  openPanel,
  panelFrame,
}) => {
  const page = await context.newPage();
  await page.goto(`${server.origin}/article.html`);
  await openPanel(page);
  const frame = await panelFrame(page);
  await expect(frame.locator('main')).toHaveAttribute('data-problem', 'no-model');
  for (const name of ['我有 API Key', '先免费试用', '用本机模型']) {
    await expect(frame.getByRole('button', { name })).toBeVisible();
  }

  // By keyboard: a mouse click on the cross-site panel frame can be lost (AGENTS.md).
  await frame.getByRole('button', { name: '用本机模型' }).press('Enter');
  // A new tab on the way in that was pressed.
  const opened = () =>
    context.pages().find((tab) => tab.url() === welcomeUrl(extensionId, 'local'));
  await expect.poll(opened).toBeDefined();
  const welcome = opened() as Page;
  await expect(welcome).toHaveURL(welcomeUrl(extensionId, 'local'));
  await expect(welcome.getByRole('button', { name: /用本机模型/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(welcome.getByRole('button', { name: '检测本机模型' })).toBeVisible();

  await storeModels(serviceWorker, server, [{ id: 'e2e', name: '', model: 'scenario:normal' }]);
  await expect(frame.locator('main')).toHaveAttribute('data-phase', 'done');
  await expect(frame.locator('article.answer')).toContainText('这篇文章介绍了');
});
