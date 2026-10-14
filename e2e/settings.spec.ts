import { readFile } from 'node:fs/promises';
import type { Locator, Page, Worker } from '@playwright/test';
import { expect, test, waitForSeededPrompt, type ChromeStorageGlobal } from './fixtures';

const optionsUrl = (extensionId: string) => `chrome-extension://${extensionId}/options.html`;
const section = (page: Page, name: string) => page.getByRole('region', { name });

function storage(serviceWorker: Worker) {
  return {
    get: (keys: string[]) =>
      serviceWorker.evaluate(
        (wanted) => (globalThis as unknown as ChromeStorageGlobal).chrome.storage.local.get(wanted),
        keys,
      ),
    set: (items: Record<string, unknown>) =>
      serviceWorker.evaluate(
        (values) => (globalThis as unknown as ChromeStorageGlobal).chrome.storage.local.set(values),
        items,
      ),
  };
}

const model = (id: string, port: number) => ({
  id,
  name: '',
  baseURL: `http://127.0.0.1:${port}/v1`,
  apiKey: '',
  model: `model-${id}`,
  headers: {},
  extraBody: {},
  contextWindow: null,
  streamUsage: true,
});

/** The default badge of a row: exactly 「默认」, unlike the 「设为默认」 button. */
const badge = (row: Locator) => row.getByText('默认', { exact: true });

/** Fills the open model form in `scope` and saves it. */
async function saveModel(scope: Locator, baseURL: string, name: string) {
  await scope.getByLabel('Base URL').fill(baseURL);
  await scope.getByLabel('模型名').fill(name);
  await scope.getByRole('button', { name: '保存' }).click();
}

test('models: add two, choose the default, reorder, remove the default; it all persists', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await context.newPage();
  await page.goto(optionsUrl(extensionId));
  const models = section(page, '模型');

  // An empty list opens the form for the first model.
  await saveModel(models, 'http://127.0.0.1:8001/v1', 'model-a');
  await expect(models.getByRole('status')).toHaveText('已保存');
  await models.getByRole('button', { name: '新增模型' }).click();
  await saveModel(models, 'http://127.0.0.1:8002/v1', 'model-b');
  await expect(models.getByRole('status')).toHaveText('已保存');

  const rowA = models.getByRole('listitem', { name: 'model-a' });
  const rowB = models.getByRole('listitem', { name: 'model-b' });
  await expect(badge(rowA)).toBeVisible();
  await expect(badge(rowB)).toHaveCount(0);
  await rowB.getByRole('button', { name: '设为默认' }).click();
  await expect(badge(rowB)).toBeVisible();
  await expect(badge(rowA)).toHaveCount(0);
  await rowB.getByRole('button', { name: '上移' }).click();
  await expect(models.getByRole('listitem')).toHaveText([/^model-b/, /^model-a/]);

  const stored = await storage(serviceWorker).get(['model-configs', 'selection']);
  const configs = (stored['model-configs'] as { data: { id: string; model: string }[] }).data;
  expect(configs.map((config) => config.model)).toEqual(['model-b', 'model-a']);
  expect(stored.selection).toMatchObject({ data: { defaultModelId: configs[0]?.id } });

  // Removing the default asks once more, then says where the default went.
  await rowB.getByRole('button', { name: '删除' }).click();
  await rowB.getByRole('button', { name: '确认删除' }).click();
  await expect(models.getByRole('status')).toHaveText(
    '已删除默认模型「model-b」，默认模型改为「model-a」。',
  );

  await page.reload();
  const rows = section(page, '模型').getByRole('listitem');
  await expect(rows).toHaveCount(1);
  await expect(badge(rows.first())).toBeVisible();
  await expect(rows.first()).toHaveAccessibleName('model-a');
});

test('a dirty row stays out of the list, and is still stored after a save', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await storage(serviceWorker).set({
    'model-configs': { version: 1, data: [model('a', 8001), { foo: 1 }] },
  });
  const page = await context.newPage();
  await page.goto(optionsUrl(extensionId));
  const models = section(page, '模型');

  await expect(models.getByRole('listitem')).toHaveCount(1);
  const row = models.getByRole('listitem', { name: 'model-a' });
  await row.getByRole('button', { name: '编辑' }).click();
  await row.getByLabel('名称').fill('改过名');
  await row.getByRole('button', { name: '保存' }).click();
  await expect(models.getByRole('status')).toHaveText('已保存');

  const stored = await storage(serviceWorker).get(['model-configs']);
  expect(stored['model-configs']).toEqual({
    version: 1,
    data: [{ ...model('a', 8001), name: '改过名' }, { foo: 1 }],
  });
});

test('an unreadable list is backed up before it is replaced; the backup can be exported and deleted', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const broken = { version: 1, data: 'not a list' };
  await storage(serviceWorker).set({ 'model-configs': broken });
  const page = await context.newPage();
  await page.goto(optionsUrl(extensionId));
  const models = section(page, '模型');
  const backups = section(page, '数据备份');

  await expect(models.getByRole('alert')).toContainText('无法识别');
  await expect(backups).toContainText('没有备份。');
  await saveModel(models, 'http://127.0.0.1:8001/v1', 'model-a');
  await expect(models.getByRole('status')).toHaveText('已保存（无法识别的旧数据已备份）');

  // The backups section reloads after the save that made a backup.
  const row = backups.getByRole('listitem');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('模型列表');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    row.getByRole('button', { name: '导出' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^yipie-backup-model-configs-\w+\.json$/);
  const exported = JSON.parse(await readFile(await download.path(), 'utf8')) as unknown;
  expect(exported).toEqual({ key: 'local:model-configs', at: expect.any(String), raw: broken });

  await row.getByRole('button', { name: '删除' }).click();
  await row.getByRole('button', { name: '确认删除' }).click();
  await expect(backups.getByRole('status')).toHaveText('已删除备份。');
  await expect(backups).toContainText('没有备份。');
  expect(await storage(serviceWorker).get(['quarantine:model-configs'])).toEqual({});
});

test('prompts: the built-in one is the default; the editor flags unknown variables', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await waitForSeededPrompt(serviceWorker);
  const page = await context.newPage();
  await page.goto(optionsUrl(extensionId));
  const prompts = section(page, 'Prompt');

  const builtIn = prompts.getByRole('listitem', { name: '网页总结' });
  await expect(badge(builtIn)).toBeVisible();

  await prompts.getByRole('button', { name: '新增 Prompt' }).click();
  const editor = prompts.getByRole('form', { name: '新增 Prompt' });
  await editor.getByLabel('名称').fill('要点');
  await editor.getByLabel('User 模板').fill('列出要点：{{content}} {{author}}');
  await expect(editor).toContainText('这些变量不认识，会原样发给模型：{{author}}');
  await editor.getByRole('button', { name: '保存' }).click();
  await expect(prompts.getByRole('status')).toHaveText('已保存');

  const mine = prompts.getByRole('listitem', { name: '要点' });
  await mine.getByRole('button', { name: '设为默认' }).click();
  await expect(badge(mine)).toBeVisible();
  await expect(badge(builtIn)).toHaveCount(0);
  const stored = await storage(serviceWorker).get(['prompt-configs', 'selection']);
  const list = (stored['prompt-configs'] as { data: { id: string; name: string; user: string }[] })
    .data;
  expect(list.map((prompt) => prompt.name)).toEqual(['网页总结', '要点']);
  expect(list[1]?.user).toBe('列出要点：{{content}} {{author}}');
  expect(stored.selection).toMatchObject({ data: { defaultPromptId: list[1]?.id } });

  await mine.getByRole('button', { name: '删除' }).click();
  await mine.getByRole('button', { name: '确认删除' }).click();
  await expect(prompts.getByRole('status')).toHaveText(
    '已删除默认 Prompt「要点」，默认 Prompt 改为「网页总结」。',
  );
  await expect(badge(builtIn)).toBeVisible();
});
