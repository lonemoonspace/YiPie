import type { BrowserContext, Frame, Page } from '@playwright/test';
import { CONTEXT_LIMIT_CHARS, NORMAL_ANSWER, type RecordedRequest } from './fake-llm/llm';
import {
  E2E_KEY,
  expect,
  session,
  storeModels,
  storeSettings,
  tabIdOf,
  test,
  useModel,
} from './fixtures';

interface Message {
  role: string;
  content: string;
}

const messagesOf = (request: RecordedRequest | undefined): Message[] =>
  (request?.body as { messages?: Message[] } | undefined)?.messages ?? [];

interface IndexEntry {
  id: string;
  tabId: number;
  pageKey: string;
  evicted: boolean;
}

/** The snapshot index and conversations in `storage.session`. */
async function snapshots(serviceWorker: Parameters<typeof session>[0]) {
  const all = await session(serviceWorker);
  const index = ((all.snapshots as { data?: IndexEntry[] } | undefined)?.data ?? []).filter(
    (entry) => !entry.evicted,
  );
  const conversation = (id: string) =>
    (all[`snapshot:${id}`] as { data?: { pageKey: string; messages: Message[] } } | undefined)
      ?.data;
  return { all, index, conversation };
}

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

/**
 * Asks with the keyboard. Under Playwright's viewport emulation, mouse clicks
 * on a cross-site frame within about 100 px of the viewport's bottom are lost
 * (a plain cross-site iframe there loses them too), and the follow-up box sits
 * at the panel's bottom. The test that clicks the button makes room instead.
 */
async function ask(frame: Frame, question: string) {
  const box = frame.getByRole('textbox', { name: '追问' });
  await box.fill(question);
  await box.press('Enter');
}

test('summarize, follow up, reload, trigger again: both rounds come back without a new request', async ({
  context,
  server,
  serviceWorker,
  openPanel,
  panelFrame,
}) => {
  await useModel(serviceWorker, server, 'scenario:chat');
  const url = `${server.origin}/article.html`;
  const { page, frame } = await open(context, url, openPanel, panelFrame);
  await expect(frame.locator('main')).toHaveAttribute('data-phase', 'done');

  await ask(frame, '它用的是谁的模型？');

  const answers = frame.locator('article.answer');
  await expect(answers).toHaveCount(2);
  await expect(answers.nth(1)).toHaveText('回答：它用的是谁的模型？');
  await expect(frame.locator('main')).toHaveAttribute('data-phase', 'done');
  // The follow-up carried the page, the summary and the question.
  expect(messagesOf(server.requests.at(-1)).map((message) => message.role)).toEqual([
    'system',
    'user',
    'assistant',
    'user',
  ]);

  // What is saved: the two answers and the question, under this tab and page.
  const tabId = await tabIdOf(serviceWorker, page);
  await expect
    .poll(async () => (await snapshots(serviceWorker)).index)
    .toEqual([expect.objectContaining({ tabId, pageKey: url })]);
  const saved = await snapshots(serviceWorker);
  const conversation = saved.conversation(saved.index[0]?.id ?? '');
  expect(conversation?.messages.map((message) => [message.role, message.content])).toEqual([
    ['assistant', expect.stringContaining('这篇文章介绍了')],
    ['user', '它用的是谁的模型？'],
    ['assistant', '回答：它用的是谁的模型？'],
  ]);
  // Never the page text, never a credential.
  const raw = JSON.stringify(saved.all);
  expect(raw).not.toContain('一瞥是一个浏览器扩展');
  expect(raw).not.toContain(E2E_KEY);

  const before = server.requests.length;
  await page.reload();
  await openPanel(page);
  const restored = await panelFrame(page);

  await expect(restored.locator('main')).toHaveAttribute('data-phase', 'restored');
  await expect(restored.getByRole('status')).toHaveText('已恢复上次的对话');
  await expect(restored.locator('article.answer')).toHaveCount(2);
  await expect(restored.locator('.question')).toHaveText('它用的是谁的模型？');
  await expect(restored.locator('article.answer').nth(1)).toHaveText('回答：它用的是谁的模型？');
  expect(server.requests).toHaveLength(before);

  // The conversation goes on from where it was, with the page read again.
  await ask(restored, '还有吗？');
  await expect(restored.locator('article.answer')).toHaveCount(3);
  const next = messagesOf(server.requests.at(-1));
  expect(next.map((message) => message.role)).toEqual([
    'system',
    'user',
    'assistant',
    'user',
    'assistant',
    'user',
  ]);
  expect(next[1]?.content).toContain('一瞥是一个浏览器扩展');
  expect(next.at(-1)?.content).toBe('还有吗？');
});

test('closing a tab deletes its conversation and leaves the others', async ({
  context,
  server,
  serviceWorker,
  openPanel,
  panelFrame,
}) => {
  await useModel(serviceWorker, server, 'scenario:normal');
  const first = await open(context, `${server.origin}/article.html`, openPanel, panelFrame);
  await expect(first.frame.locator('main')).toHaveAttribute('data-phase', 'done');
  const second = await open(context, `${server.origin}/long.html`, openPanel, panelFrame);
  await expect(second.frame.locator('main')).toHaveAttribute('data-phase', 'done');
  const [closing, staying] = [
    await tabIdOf(serviceWorker, first.page),
    await tabIdOf(serviceWorker, second.page),
  ];
  await expect
    .poll(async () => (await snapshots(serviceWorker)).index.map((entry) => entry.tabId).sort())
    .toEqual([closing, staying].sort());
  const closedId = (await snapshots(serviceWorker)).index.find(
    (entry) => entry.tabId === closing,
  )?.id;

  await first.page.close();

  await expect
    .poll(async () => (await snapshots(serviceWorker)).index.map((entry) => entry.tabId))
    .toEqual([staying]);
  const after = await snapshots(serviceWorker);
  expect(after.all).not.toHaveProperty(`snapshot:${closedId}`);
  expect(after.all['panel-registry']).not.toHaveProperty(String(closing));
});

test('usage shows the figures the service reported, or an estimate marked ≈', async ({
  context,
  server,
  serviceWorker,
  openPanel,
  panelFrame,
}) => {
  await storeModels(serviceWorker, server, [
    { id: 'reports', name: '报用量', model: 'scenario:normal' },
    { id: 'silent', name: '不报用量', model: 'scenario:no-usage' },
  ]);
  const { frame } = await open(context, `${server.origin}/article.html`, openPanel, panelFrame);

  const usage = frame.locator('.usage');
  await expect(usage).toHaveText('输入 321 · 输出 45 tokens');
  await expect(usage).toHaveAttribute('data-usage', 'service');

  await frame.getByRole('combobox', { name: '模型' }).selectOption({ label: '不报用量' });

  await expect(usage).toHaveAttribute('data-usage', 'estimate');
  await expect(usage).toHaveText(/^≈ 输入 [\d,]+ · 输出 [\d,]+ tokens$/);
});

test('a page too long for the model is cut as the settings say, and the panel says so', async ({
  context,
  server,
  serviceWorker,
  openPanel,
  panelFrame,
}) => {
  await storeModels(serviceWorker, server, [
    { id: 'small', name: '小模型', model: 'scenario:normal', contextWindow: 2_048 },
  ]);
  await storeSettings(serviceWorker, { trimming: 'front' });
  const { frame } = await open(context, `${server.origin}/long.html`, openPanel, panelFrame);
  await expect(frame.locator('main')).toHaveAttribute('data-phase', 'done');

  const sent = messagesOf(server.requests.at(-1))[1]?.content ?? '';
  // The start went; the end stayed.
  expect(sent).toContain('第300段');
  expect(sent).not.toContain('第1段：');
  expect(sent).toContain('前面的一部分正文没有发送');
  await expect(frame.locator('.turn .note')).toContainText('已按「截掉开头」保留约');
});

test('sent as it is and refused as too long, the page can be cut and sent again', async ({
  context,
  server,
  serviceWorker,
  openPanel,
  panelFrame,
}) => {
  await storeModels(serviceWorker, server, [
    { id: 'local', name: '本地', model: 'scenario:context-limit', contextWindow: 2_048 },
  ]);
  await storeSettings(serviceWorker, { trimming: 'nothing' });
  const { frame } = await open(context, `${server.origin}/long.html`, openPanel, panelFrame);

  const alert = frame.getByRole('alert');
  await expect(alert).toContainText('请求超出了模型的上下文窗口');
  await expect(alert).toContainText('当前的设置是「不裁剪」');
  const refused = server.requests.length;
  expect(
    messagesOf(server.requests.at(-1)).reduce((sum, message) => sum + message.content.length, 0),
  ).toBeGreaterThan(CONTEXT_LIMIT_CHARS);

  await frame.getByRole('button', { name: '裁剪后重试' }).click();

  await expect(frame.locator('main')).toHaveAttribute('data-phase', 'done');
  expect(server.requests).toHaveLength(refused + 1);
  await expect(frame.locator('.turn .note')).toContainText('已按「截掉结尾」保留约');
});

test("copy puts the answer's Markdown on the clipboard", async ({
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

  await frame.getByRole('button', { name: '复制' }).click();

  await expect(frame.getByRole('button', { name: '已复制' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(NORMAL_ANSWER.join(''));
});

test('the send button asks too, and Shift+Enter starts a new line instead', async ({
  context,
  server,
  serviceWorker,
  openPanel,
  panelFrame,
}) => {
  await useModel(serviceWorker, server, 'scenario:chat');
  const page = await context.newPage();
  // Room below the panel: see `ask`.
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(`${server.origin}/article.html`);
  await openPanel(page);
  const frame = await panelFrame(page);
  await expect(frame.locator('main')).toHaveAttribute('data-phase', 'done');
  const box = frame.getByRole('textbox', { name: '追问' });
  const send = frame.getByRole('button', { name: '发送' });

  await expect(send).toBeDisabled();
  await box.fill('第一行');
  await box.press('Shift+Enter');
  await box.pressSequentially('第二行');
  await expect(box).toHaveValue('第一行\n第二行');
  await send.click();

  await expect(frame.locator('article.answer')).toHaveCount(2);
  await expect(frame.locator('.question')).toHaveText('第一行\n第二行');
  await expect(box).toHaveValue('');
  expect(messagesOf(server.requests.at(-1)).at(-1)?.content).toBe('第一行\n第二行');
});
