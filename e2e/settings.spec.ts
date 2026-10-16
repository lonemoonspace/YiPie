import { readFile } from 'node:fs/promises';
import type { Download, Locator, Page } from '@playwright/test';
import {
  E2E_KEY,
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

  await rowAction(modelRow(page, '备用'), '设为默认');
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
  await rowAction(modelRow(page, '备用'), '删除');
  await expect.poll(() => questions.length).toBe(1);
  expect(await storedIds()).toEqual(['spare', 'main']);

  page.once('dialog', (dialog) => {
    questions.push(dialog.message());
    void dialog.accept();
  });
  await rowAction(modelRow(page, '备用'), '删除');
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

/** Presses one of the actions a row keeps behind its "⋯" button. */
async function rowAction(row: Locator, name: string): Promise<void> {
  await row.getByRole('button', { name: '更多操作' }).click();
  await row.getByRole('button', { name }).click();
}

const promptRow = (page: Page, name: string) =>
  section(page, 'Prompt').getByRole('listitem').filter({ hasText: name });

test('prompts: the built-in ones are there from the start, and an edit to one is stored', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await context.newPage();
  await page.goto(optionsUrl(extensionId));
  const prompts = section(page, 'Prompt');
  const row = promptRow(page, '网页总结');

  await expect(prompts.getByRole('listitem')).toHaveCount(3);
  await expect(prompts.getByRole('listitem')).toContainText(['网页总结', '速读', '深度笔记']);
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
      expect.objectContaining({ id: 'builtin-quick', name: '速读' }),
      expect.objectContaining({ id: 'builtin-notes', name: '深度笔记' }),
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

  // A preset fills the whole form, its name included.
  await form.getByRole('button', { name: '用预设「速读」填写' }).click();
  await expect(form.getByLabel('名称')).toHaveValue('速读');
  await expect(form.getByLabel('系统模板')).toHaveValue(/30 秒能读完/);

  await form.getByLabel('名称').fill('要点');
  await form.getByLabel('系统模板').fill('');
  await form.getByLabel('用户模板').fill('列出要点：{{content}}');
  await form.getByRole('button', { name: '保存' }).click();
  await expect(prompts.getByRole('status')).toHaveText('已保存');
  await expect(prompts.getByRole('listitem')).toHaveCount(4);

  await rowAction(promptRow(page, '要点'), '设为默认');
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

test('models: a common service fills the Base URL, and reserved body fields are refused', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await context.newPage();
  await page.goto(optionsUrl(extensionId));
  const form = section(page, '模型').getByRole('form', { name: '添加模型' });

  await form.getByRole('button', { name: '填入 DeepSeek 的地址' }).click();
  await expect(form.getByLabel('Base URL')).toHaveValue('https://api.deepseek.com/v1');

  await form.getByLabel('模型名').fill('deepseek-chat');
  await form.getByText('高级', { exact: true }).click();
  await form.getByLabel('额外请求体字段（JSON 对象）').fill('{"stream": false}');
  await form.getByRole('button', { name: '保存' }).click();

  await expect(form.getByText('请求自己会设置 stream，额外请求体字段不能覆盖它')).toBeVisible();
  expect(await stored(serviceWorker, 'model-configs')).toBeUndefined();
});

test('models: test connection reads the model list, or offers one real request', async ({
  context,
  extensionId,
  server,
}) => {
  const page = await context.newPage();
  await page.goto(optionsUrl(extensionId));
  const form = section(page, '模型').getByRole('form', { name: '添加模型' });
  const result = form.locator('.test-result');

  await form.getByLabel('Base URL').fill(`${server.origin}/v1`);
  await form.getByLabel('模型名').fill('scenario:normal');
  await form.getByRole('button', { name: '测试连接' }).click();
  await expect(result).toHaveText(/连接成功：服务列出了 3 个模型。其中有「scenario:normal」。/);

  await form.getByLabel('模型名').fill('scenario:typo');
  await form.getByRole('button', { name: '测试连接' }).click();
  await expect(result).toContainText('列表里没有「scenario:typo」');

  // A service without a model list: nothing is sent until the user asks.
  await form.getByLabel('Base URL').fill(`${server.origin}/no-models/v1`);
  await form.getByLabel('模型名').fill('scenario:normal');
  const before = server.requests.length;
  await form.getByRole('button', { name: '测试连接' }).click();
  await expect(result).toContainText('服务没有提供模型列表');
  expect(server.requests).toHaveLength(before);

  await result.getByRole('button', { name: '发送测试请求' }).click();
  await expect(result).toHaveText('连接成功：模型回答了。');
  expect(server.requests.at(-1)?.path).toBe('/no-models/v1/chat/completions');
});

test("models: the model name can be picked from the service's model list", async ({
  context,
  extensionId,
  serviceWorker,
  server,
}) => {
  const page = await context.newPage();
  await page.goto(optionsUrl(extensionId));
  const form = section(page, '模型').getByRole('form', { name: '添加模型' });
  // Without an address there is nothing to ask: the field says so.
  await form.getByRole('button', { name: '获取模型列表' }).click();
  await expect(form.getByText('请填写 Base URL')).toBeVisible();

  await form.getByLabel('Base URL').fill(`${server.origin}/v1`);
  await form.getByRole('button', { name: '获取模型列表' }).click();
  const picker = form.getByRole('combobox', { name: '从服务的模型列表里选择' });
  await expect(picker.locator('option')).toHaveText([
    '选择一个模型（共 3 个）',
    'scenario:chat',
    'scenario:cite',
    'scenario:normal',
  ]);

  await picker.selectOption('scenario:chat');
  await expect(form.getByLabel('模型名')).toHaveValue('scenario:chat');
  await form.getByRole('button', { name: '保存' }).click();
  await expect
    .poll(
      async () => ((await stored(serviceWorker, 'model-configs')) as StoredList | undefined)?.data,
    )
    .toEqual([expect.objectContaining({ model: 'scenario:chat' })]);

  // A service without a model list: the name is typed instead.
  await section(page, '模型').getByRole('button', { name: '添加模型' }).click();
  const second = section(page, '模型').getByRole('form', { name: '添加模型' });
  await second.getByLabel('Base URL').fill(`${server.origin}/no-models/v1`);
  await second.getByRole('button', { name: '获取模型列表' }).click();
  await expect(second.locator('.fetch-result')).toHaveText(
    '服务没有提供模型列表（GET /models），请手动填写模型名。',
  );
  await expect(second.getByRole('combobox', { name: '从服务的模型列表里选择' })).toHaveCount(0);
});

test('prompts: unknown variables are flagged in red, and the preview renders a sample page', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(optionsUrl(extensionId));
  const prompts = section(page, 'Prompt');
  await prompts.getByRole('button', { name: '添加 Prompt' }).click();
  const form = prompts.getByRole('form', { name: '添加 Prompt' });

  await form.getByLabel('用户模板').fill('{{title}}：{{content}} {{foo}}');
  await expect(form.locator('.warning.flagged')).toHaveText('未知变量 {{foo}} 会原样发送给模型。');

  await form.getByText('预览（用一个示例页面渲染）').click();
  await expect(form.locator('pre').last()).toHaveText(
    '示例：一瞥的设计笔记：（这里是网页正文） {{foo}}',
  );
  await form.getByText('可用的变量').click();
  await expect(form.getByText('{{selection}}', { exact: true })).toBeVisible();
});

test('transfer: export without keys unless asked, then import appends with new ids', async ({
  context,
  extensionId,
  serviceWorker,
  server,
}) => {
  await storeModels(serviceWorker, server, [MAIN, SPARE]);
  const page = await context.newPage();
  await page.goto(optionsUrl(extensionId));
  const transfer = section(page, '导入与导出');
  await expect(modelRow(page, '备用')).toHaveCount(1);

  const exportFile = async () => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      transfer.getByRole('button', { name: '导出模型与 Prompt' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^yipie-config-\d{4}-\d{2}-\d{2}\.json$/);
    return { path: await download.path(), file: (await readDownload(download)) as ExportFile };
  };

  const plain = await exportFile();
  await expect(transfer.getByRole('status')).toHaveText('已导出 2 个模型、3 个 Prompt（不含凭据）');
  expect(JSON.stringify(plain.file)).not.toContain(E2E_KEY);
  expect(plain.file.models.map((model) => model.name)).toEqual(['主力', '备用']);
  expect(plain.file.prompts.map((prompt) => prompt.name)).toEqual(['网页总结', '速读', '深度笔记']);

  await transfer.getByLabel('文件里带上凭据').check();
  const full = await exportFile();
  expect(full.file.models.map((model) => model.apiKey)).toEqual([E2E_KEY, E2E_KEY]);

  // Something that is not an export: refused, nothing written.
  await transfer.getByLabel('选择要导入的文件').setInputFiles({
    name: 'other.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'yipie-config', version: 1, models: [{}] })),
  });
  await expect(transfer.getByRole('alert')).toContainText('没有一条能识别');
  await expect(transfer.getByRole('button', { name: '导入', exact: true })).toHaveCount(0);

  await transfer.getByLabel('选择要导入的文件').setInputFiles(full.path);
  await expect(transfer.locator('[data-import-preview]')).toContainText(
    '将新增 2 个模型、3 个 Prompt；跳过 0 条无法识别的条目。',
  );
  await transfer.getByRole('button', { name: '导入', exact: true }).click();
  await expect(transfer.getByRole('status')).toHaveText('已导入 2 个模型、3 个 Prompt');

  // The models section reads the list again without a reload.
  await expect(modelRow(page, '备用')).toHaveCount(2);
  const models = (await stored(serviceWorker, 'model-configs')) as {
    data: { id: string; name: string; apiKey: string; model: string }[];
  };
  expect(models.data.map((model) => model.name)).toEqual(['主力', '备用', '主力', '备用']);
  expect(models.data.slice(0, 2).map((model) => model.id)).toEqual(['main', 'spare']);
  expect(new Set(models.data.map((model) => model.id)).size).toBe(4);
  expect(models.data.slice(2).map((model) => [model.model, model.apiKey])).toEqual([
    ['scenario:normal', E2E_KEY],
    ['scenario:slow', E2E_KEY],
  ]);
  const prompts = (await stored(serviceWorker, 'prompt-configs')) as StoredList;
  expect(prompts.data.map((prompt) => prompt.name)).toEqual([
    '网页总结',
    '速读',
    '深度笔记',
    '网页总结',
    '速读',
    '深度笔记',
  ]);
  // The default stays where it was: the first model.
  await page.reload();
  await expect(modelRow(page, '主力').first()).toContainText('默认');
});

interface ExportFile {
  models: { name: string; apiKey?: string }[];
  prompts: { name: string }[];
}
