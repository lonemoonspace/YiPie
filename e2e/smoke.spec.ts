import type { Page } from '@playwright/test';
import { expect, test, type ChromeStorageGlobal } from './fixtures';

const optionsUrl = (extensionId: string) => `chrome-extension://${extensionId}/options.html`;
const section = (page: Page, name: string) => page.getByRole('region', { name });

test('the service worker starts and the options page renders', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(optionsUrl(extensionId));

  await expect(page.getByRole('heading', { name: '设置' })).toBeVisible();
  await expect(page.getByLabel('主题')).toHaveValue('system');
});

test('a setting saved through the background RPC survives a reload', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await context.newPage();
  await page.goto(optionsUrl(extensionId));

  await page.getByLabel('主题').selectOption('dark');
  await expect(section(page, '通用').getByRole('status')).toHaveText('已保存');

  // Written by the background, inside the versioned envelope.
  const stored = await serviceWorker.evaluate(() =>
    (globalThis as unknown as ChromeStorageGlobal).chrome.storage.local.get('general-settings'),
  );
  expect(stored).toEqual({
    'general-settings': {
      version: 1,
      data: {
        theme: 'dark',
        logLevel: 'info',
        trimming: 'back',
        fontSize: 'medium',
        answerLanguage: 'interface',
        interfaceLanguage: 'auto',
        autoSummarize: true,
      },
    },
  });

  // After a reload the page is rebuilt from storage, not from React state.
  await page.reload();
  await expect(page.getByLabel('主题')).toHaveValue('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('unreadable settings show defaults and are backed up before the next save', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const broken = { version: 1, data: { theme: 42 } };
  await serviceWorker.evaluate(
    (value) =>
      (globalThis as unknown as ChromeStorageGlobal).chrome.storage.local.set({
        'general-settings': value,
      }),
    broken,
  );

  const page = await context.newPage();
  await page.goto(optionsUrl(extensionId));
  await expect(section(page, '通用').getByRole('alert')).toContainText('无法识别');
  await expect(page.getByLabel('主题')).toHaveValue('system');

  await page.getByLabel('主题').selectOption('light');
  await expect(section(page, '通用').getByRole('status')).toHaveText(
    '已保存（无法识别的旧数据已备份）',
  );

  const backup = await serviceWorker.evaluate(() =>
    (globalThis as unknown as ChromeStorageGlobal).chrome.storage.local.get(
      'quarantine:general-settings',
    ),
  );
  expect(backup['quarantine:general-settings']).toEqual([
    expect.objectContaining({ key: 'local:general-settings', raw: broken }),
  ]);
});

test('a model configuration is saved through the background and shown after a reload', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await context.newPage();
  await page.goto(optionsUrl(extensionId));
  const models = section(page, '模型');

  await models.getByLabel('Base URL').fill('http://127.0.0.1:11434/v1/chat/completions/');
  await models.getByLabel('API Key').fill('sk-e2e-not-a-real-key');
  await models.getByLabel('模型名').fill('qwen2.5:7b');
  await models.getByRole('button', { name: '保存' }).click();
  await expect(models.getByRole('status')).toHaveText('已保存');

  const stored = await serviceWorker.evaluate(() =>
    (globalThis as unknown as ChromeStorageGlobal).chrome.storage.local.get('model-configs'),
  );
  expect(stored['model-configs']).toEqual({
    version: 1,
    data: [
      expect.objectContaining({
        id: expect.any(String),
        baseURL: 'http://127.0.0.1:11434/v1',
        apiKey: 'sk-e2e-not-a-real-key',
        model: 'qwen2.5:7b',
      }),
    ],
  });

  // After a reload the list is rebuilt from storage: the one model, as the default.
  await page.reload();
  const row = section(page, '模型').getByRole('listitem');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('qwen2.5:7b · http://127.0.0.1:11434');
  await expect(row.getByText('默认', { exact: true })).toBeVisible();

  await row.getByRole('button', { name: '编辑' }).click();
  await expect(row.getByLabel('Base URL')).toHaveValue('http://127.0.0.1:11434/v1');
  await expect(row.getByLabel('模型名')).toHaveValue('qwen2.5:7b');
});

test('the model form reports problems next to their fields and saves nothing', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await context.newPage();
  await page.goto(optionsUrl(extensionId));
  const models = section(page, '模型');

  await models.getByLabel('Base URL').fill('localhost:11434');
  await models.getByRole('button', { name: '保存' }).click();

  await expect(models.getByText('Base URL 必须以 http:// 或 https:// 开头')).toBeVisible();
  await expect(models.getByText('请填写模型名')).toBeVisible();
  await expect(models.getByLabel('Base URL')).toHaveAttribute('aria-invalid', 'true');
  const stored = await serviceWorker.evaluate(() =>
    (globalThis as unknown as ChromeStorageGlobal).chrome.storage.local.get('model-configs'),
  );
  expect(stored).toEqual({});
});
