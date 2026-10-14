import { expect, test, type ChromeStorageGlobal } from './fixtures';

const optionsUrl = (extensionId: string) => `chrome-extension://${extensionId}/options.html`;

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
  await expect(page.getByRole('status')).toHaveText('已保存');

  // Written by the background, inside the versioned envelope.
  const stored = await serviceWorker.evaluate(() =>
    (globalThis as unknown as ChromeStorageGlobal).chrome.storage.local.get('general-settings'),
  );
  expect(stored).toEqual({
    'general-settings': { version: 1, data: { theme: 'dark', logLevel: 'info' } },
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
  await expect(page.getByRole('alert')).toContainText('无法识别');
  await expect(page.getByLabel('主题')).toHaveValue('system');

  await page.getByLabel('主题').selectOption('light');
  await expect(page.getByRole('status')).toHaveText('已保存（无法识别的旧数据已备份）');

  const backup = await serviceWorker.evaluate(() =>
    (globalThis as unknown as ChromeStorageGlobal).chrome.storage.local.get(
      'quarantine:general-settings',
    ),
  );
  expect(backup['quarantine:general-settings']).toEqual([
    expect.objectContaining({ key: 'local:general-settings', raw: broken }),
  ]);
});
