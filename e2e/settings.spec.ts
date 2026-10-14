import type { Page } from '@playwright/test';
import {
  expect,
  storeModels,
  stored,
  test,
  type ChromeStorageGlobal,
  type StoredModel,
} from './fixtures';

const optionsUrl = (extensionId: string) => `chrome-extension://${extensionId}/options.html`;
const section = (page: Page, name: string) => page.getByRole('region', { name });
const modelRow = (page: Page, name: string) =>
  section(page, '模型').getByRole('listitem').filter({ hasText: name });

const MAIN: StoredModel = { id: 'main', name: '主力', model: 'scenario:normal' };
const SPARE: StoredModel = { id: 'spare', name: '备用', model: 'scenario:slow' };

interface StoredList {
  version: number;
  data: { id?: string; name?: string }[];
}

test('models: choose a default, reorder, and remove the default with a fallback', async ({
  context,
  extensionId,
  serviceWorker,
  server,
}) => {
  await storeModels(serviceWorker, server, [MAIN, SPARE]);
  const page = await context.newPage();
  await page.goto(optionsUrl(extensionId));
  const models = section(page, '模型');
  const storedIds = async () =>
    ((await stored(serviceWorker, 'model-configs')) as StoredList).data.map((row) => row.id);

  // Nothing chosen yet: the first one is the default.
  await expect(models.getByRole('listitem')).toHaveCount(2);
  await expect(modelRow(page, '主力').getByText('默认', { exact: true })).toBeVisible();

  await modelRow(page, '备用').getByRole('button', { name: '设为默认' }).click();
  await expect(models.getByRole('status')).toHaveText('已将「备用」设为默认');
  await expect(modelRow(page, '备用').getByText('默认', { exact: true })).toBeVisible();
  expect(await stored(serviceWorker, 'selection')).toEqual({
    version: 1,
    data: { defaultModelId: 'spare', defaultPromptId: null },
  });

  await modelRow(page, '备用').getByRole('button', { name: '上移' }).click();
  await expect(models.getByRole('status')).toHaveText('已上移「备用」');
  await expect(models.getByRole('listitem').first()).toContainText('备用');
  expect(await storedIds()).toEqual(['spare', 'main']);

  // Removing asks first, and says what happens to the default; declining keeps it.
  const questions: string[] = [];
  page.once('dialog', (dialog) => {
    questions.push(dialog.message());
    void dialog.dismiss();
  });
  await modelRow(page, '备用').getByRole('button', { name: '删除' }).click();
  await expect.poll(() => questions.length).toBe(1);
  expect(await storedIds()).toEqual(['spare', 'main']);

  page.once('dialog', (dialog) => {
    questions.push(dialog.message());
    void dialog.accept();
  });
  await modelRow(page, '备用').getByRole('button', { name: '删除' }).click();
  await expect(models.getByRole('status')).toHaveText('已删除「备用」。默认模型改为「主力」。');
  expect(questions).toEqual([
    '删除模型「备用」？它是默认模型，删除后默认模型改为「主力」。',
    '删除模型「备用」？它是默认模型，删除后默认模型改为「主力」。',
  ]);
  expect(await storedIds()).toEqual(['main']);

  await page.reload();
  await expect(models.getByRole('listitem')).toHaveCount(1);
  await expect(modelRow(page, '主力').getByText('默认', { exact: true })).toBeVisible();
});

test('models: another one is added below, and editing sends only what changed', async ({
  context,
  extensionId,
  serviceWorker,
  server,
}) => {
  await storeModels(serviceWorker, server, [MAIN]);
  const page = await context.newPage();
  await page.goto(optionsUrl(extensionId));
  const models = section(page, '模型');

  await models.getByRole('button', { name: '添加模型' }).click();
  const form = models.getByRole('form', { name: '添加模型' });
  await form.getByLabel('Base URL').fill('http://127.0.0.1:8000/v1');
  await form.getByLabel('模型名').fill('llama3.1:8b');
  await form.getByRole('button', { name: '保存' }).click();
  await expect(models.getByRole('status')).toHaveText('已保存');
  await expect(models.getByRole('listitem')).toHaveCount(2);
  await expect(models.getByRole('listitem').nth(1)).toContainText('llama3.1:8b');
  await expect(modelRow(page, '主力').getByText('默认', { exact: true })).toBeVisible();

  // Meanwhile another tab changes the key of 主力; this page's form still shows the old one.
  await modelRow(page, '主力').getByRole('button', { name: '编辑' }).click();
  await serviceWorker.evaluate(async () => {
    const { chrome } = globalThis as unknown as ChromeStorageGlobal;
    const all = await chrome.storage.local.get('model-configs');
    const list = all['model-configs'] as { version: number; data: { apiKey: string }[] };
    if (list.data[0]) list.data[0].apiKey = 'sk-changed-elsewhere';
    await chrome.storage.local.set({ 'model-configs': list });
  });
  await modelRow(page, '主力').getByLabel('名称').fill('主力（改名）');
  await modelRow(page, '主力').getByRole('button', { name: '保存' }).click();
  await expect(models.getByRole('status')).toHaveText('已保存');

  const list = (await stored(serviceWorker, 'model-configs')) as StoredList;
  expect(list.data[0]).toMatchObject({ name: '主力（改名）', apiKey: 'sk-changed-elsewhere' });
});

test('models: a row this version cannot read is kept, and only counted', async ({
  context,
  extensionId,
  serviceWorker,
  server,
}) => {
  await storeModels(serviceWorker, server, [MAIN], { extra: [{ foo: 1 }] });
  const page = await context.newPage();
  await page.goto(optionsUrl(extensionId));
  const models = section(page, '模型');

  await expect(models.getByRole('listitem')).toHaveCount(1);
  await expect(models).toContainText('另有 1 条记录当前版本无法识别，已原样保留，这里不显示。');

  await modelRow(page, '主力').getByRole('button', { name: '编辑' }).click();
  await modelRow(page, '主力').getByLabel('名称').fill('主力（改名）');
  await modelRow(page, '主力').getByRole('button', { name: '保存' }).click();
  await expect(models.getByRole('status')).toHaveText('已保存');

  const list = (await stored(serviceWorker, 'model-configs')) as StoredList;
  expect(list.data).toHaveLength(2);
  expect(list.data[0]).toMatchObject({ id: 'main', name: '主力（改名）' });
  expect(list.data[1]).toEqual({ foo: 1 });
});

test('models: an unreadable list is flagged, and backed up before the next save', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const broken = { version: 1, data: 'not a list' };
  await serviceWorker.evaluate(
    (value) =>
      (globalThis as unknown as ChromeStorageGlobal).chrome.storage.local.set({
        'model-configs': value,
      }),
    broken,
  );
  const page = await context.newPage();
  await page.goto(optionsUrl(extensionId));
  const models = section(page, '模型');

  await expect(models.getByRole('alert')).toContainText('无法识别');
  await models.getByLabel('Base URL').fill('http://127.0.0.1:11434/v1');
  await models.getByLabel('模型名').fill('qwen2.5:7b');
  await models.getByRole('button', { name: '保存' }).click();
  await expect(models.getByRole('status')).toHaveText('已保存（无法识别的旧数据已备份）');

  expect(await stored(serviceWorker, 'quarantine:model-configs')).toEqual([
    expect.objectContaining({ key: 'local:model-configs', raw: broken }),
  ]);
});

test('models: a service we hold no access to is marked, with a way to grant it', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await serviceWorker.evaluate(() =>
    (globalThis as unknown as ChromeStorageGlobal).chrome.storage.local.set({
      'model-configs': {
        version: 1,
        data: [
          { id: 'far', name: '远端', baseURL: 'https://api.unreachable.example/v1', model: 'm' },
        ],
      },
    }),
  );
  const page = await context.newPage();
  await page.goto(optionsUrl(extensionId));

  const row = modelRow(page, '远端');
  await expect(row.getByText('未授权', { exact: true })).toBeVisible();
  await expect(row).toContainText('尚未授权访问 https://api.unreachable.example');
  await expect(row.getByRole('button', { name: '授权访问' })).toBeVisible();
});
