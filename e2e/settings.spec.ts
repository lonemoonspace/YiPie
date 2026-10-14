import { readFile } from 'node:fs/promises';
import type { Download, Page } from '@playwright/test';
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

const promptRow = (page: Page, name: string) =>
  section(page, 'Prompt').getByRole('listitem').filter({ hasText: name });

test('prompts: the built-in one is there from the start, and an edit to it is stored', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await context.newPage();
  await page.goto(optionsUrl(extensionId));
  const prompts = section(page, 'Prompt');
  const row = promptRow(page, '网页总结');

  await expect(prompts.getByRole('listitem')).toHaveCount(1);
  await expect(row.getByText('默认', { exact: true })).toBeVisible();
  // Shown, not stored: nothing is written until the user changes something.
  expect(await stored(serviceWorker, 'prompt-configs')).toBeUndefined();

  await row.getByRole('button', { name: '编辑' }).click();
  await row.getByLabel('用户模板').fill('标题：{{title}}\n{{ foo }}');
  // Pointed out while typing; neither stops the save.
  await expect(row).toContainText('未知变量 {{ foo }} 会原样发送给模型。');
  await expect(row).toContainText('两个模板里都没有 {{content}}：页面正文不会发送给模型。');
  await row.getByLabel('用户模板').fill('标题：{{title}}\n{{ foo }}\n{{content}}');
  await expect(row).not.toContainText('两个模板里都没有');
  await row.getByRole('button', { name: '保存' }).click();
  await expect(prompts.getByRole('status')).toHaveText('已保存');

  expect(await stored(serviceWorker, 'prompt-configs')).toEqual({
    version: 1,
    data: [
      expect.objectContaining({
        id: 'builtin-summary',
        name: '网页总结',
        user: '标题：{{title}}\n{{ foo }}\n{{content}}',
      }),
    ],
  });
});

test('prompts: a new one starts from the built-in templates, needs a name, and can be the default', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await context.newPage();
  await page.goto(optionsUrl(extensionId));
  const prompts = section(page, 'Prompt');

  await prompts.getByRole('button', { name: '添加 Prompt' }).click();
  const form = prompts.getByRole('form', { name: '添加 Prompt' });
  await expect(form.getByLabel('用户模板')).toHaveValue(/\{\{content\}\}/);
  await expect(form.getByLabel('系统模板')).toHaveValue(/网页阅读助手/);

  await form.getByRole('button', { name: '保存' }).click();
  await expect(form.getByText('请填写名称')).toBeVisible();
  expect(await stored(serviceWorker, 'prompt-configs')).toBeUndefined();

  await form.getByLabel('名称').fill('要点');
  await form.getByLabel('系统模板').fill('');
  await form.getByLabel('用户模板').fill('列出要点：{{content}}');
  await form.getByRole('button', { name: '保存' }).click();
  await expect(prompts.getByRole('status')).toHaveText('已保存');
  await expect(prompts.getByRole('listitem')).toHaveCount(2);

  await promptRow(page, '要点').getByRole('button', { name: '设为默认' }).click();
  await expect(prompts.getByRole('status')).toHaveText('已将「要点」设为默认');

  const list = (await stored(serviceWorker, 'prompt-configs')) as StoredList;
  const added = list.data.find((prompt) => prompt.name === '要点');
  expect(added).toMatchObject({ system: '', user: '列出要点：{{content}}' });
  expect(await stored(serviceWorker, 'selection')).toEqual({
    version: 1,
    data: { defaultModelId: null, defaultPromptId: added?.id },
  });
});

const readDownload = async (download: Download): Promise<unknown> =>
  JSON.parse(await readFile(await download.path(), 'utf8'));

test('backups: shown without credentials, exported with them only on request, and deleted', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const raw = {
    version: 1,
    data: {
      configs: [
        {
          id: 'x',
          baseURL: 'https://gw.example/v1?key=query-secret',
          apiKey: 'sk-in-backup',
          headers: { 'X-API-Key': 'header-secret' },
          model: 'm',
        },
      ],
    },
  };
  const at = '2026-10-14T10:00:00.000Z';
  await serviceWorker.evaluate(
    (entry) =>
      (globalThis as unknown as ChromeStorageGlobal).chrome.storage.local.set({
        'quarantine:model-configs': [entry],
      }),
    { key: 'local:model-configs', at, raw },
  );
  const page = await context.newPage();
  await page.goto(optionsUrl(extensionId));
  const backups = section(page, '备份');
  const row = backups.getByRole('listitem');

  await expect(row).toHaveCount(1);
  await expect(row).toContainText('模型列表');
  await row.getByText('查看内容（不含凭据）').click();
  const shown = row.locator('pre');
  await expect(shown).toContainText('https://gw.example/v1');
  for (const secret of ['sk-in-backup', 'header-secret', 'query-secret']) {
    await expect(shown).not.toContainText(secret);
  }

  const [plain] = await Promise.all([
    page.waitForEvent('download'),
    row.getByRole('button', { name: '导出' }).click(),
  ]);
  expect(plain.suggestedFilename()).toBe(
    'yipie-backup-model-configs-2026-10-14T10-00-00-000Z.json',
  );
  expect(await readDownload(plain)).toEqual({
    key: 'local:model-configs',
    at,
    raw: {
      version: 1,
      data: { configs: [{ id: 'x', baseURL: 'https://gw.example/v1', model: 'm' }] },
    },
  });

  await backups.getByLabel('导出时包含 API Key、请求头与 Base URL 的查询参数').check();
  const [full] = await Promise.all([
    page.waitForEvent('download'),
    row.getByRole('button', { name: '导出' }).click(),
  ]);
  expect(await readDownload(full)).toEqual({ key: 'local:model-configs', at, raw });

  page.once('dialog', (dialog) => void dialog.accept());
  await row.getByRole('button', { name: '删除' }).click();
  await expect(backups.getByRole('status')).toHaveText('已删除备份');
  await expect(backups).toContainText('没有备份。');
  expect(await stored(serviceWorker, 'quarantine:model-configs')).toBeUndefined();
});

test('backups: one taken by a save elsewhere on the page shows up without a reload', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await serviceWorker.evaluate(() =>
    (globalThis as unknown as ChromeStorageGlobal).chrome.storage.local.set({
      'general-settings': { version: 1, data: { theme: 42 } },
    }),
  );
  const page = await context.newPage();
  await page.goto(optionsUrl(extensionId));
  const backups = section(page, '备份');
  await expect(backups).toContainText('没有备份。');

  await page.getByLabel('主题').selectOption('dark');
  await expect(section(page, '通用').getByRole('status')).toHaveText(
    '已保存（无法识别的旧数据已备份）',
  );

  await expect(backups.getByRole('listitem')).toHaveCount(1);
  await expect(backups.getByRole('listitem')).toContainText('通用设置');
});
