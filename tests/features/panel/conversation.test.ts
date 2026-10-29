import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { PageContext } from '@/contract/page-context';
import type { PanelModelConfig, SnapshotView } from '@/contract/rpc';
import { SNAPSHOT_MESSAGE_LENGTH, SNAPSHOT_PAGE_BYTES, SnapshotMessage } from '@/contract/snapshot';
import { fitPage } from '@/platform/snapshot/store';
import { estimateMessages, outputReserve } from '@/domain/budget';
import type { LlmError } from '@/domain/llm/errors';
import type { ChatMessage } from '@/domain/llm/request';
import type { Usage } from '@/domain/llm/stream';
import { TRUNCATION_NOTE } from '@/domain/prompt/messages';
import { estimateTokens } from '@/domain/token-estimate';
import {
  CUT_RETRY_STRATEGY,
  createConversation,
  toExchanges,
  savedText,
  toSnapshotMessages,
  type RunSetup,
  type StreamRequest,
} from '@/features/panel/conversation';
import { INITIAL_PANEL_STATE, reducePanel, type PanelEvent } from '@/features/panel/state';
import type { ModelPick } from '@/features/panel/model-switcher';
import type { ChatOutcome } from '@/platform/llm/client';

const config: PanelModelConfig = {
  id: 'm1',
  name: '主力',
  baseURL: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  model: 'gpt-test',
  headers: {},
  extraBody: {},
  contextWindow: null,
  streamUsage: true,
};

const prompt = { system: '系统：用{{language}}回答', user: '正文：{{content}}' };

const page: PageContext = {
  title: '标题',
  url: 'https://example.com/post',
  lang: 'zh-CN',
  text: '页面正文。',
  selection: '',
  truncated: false,
};

const reported: Usage = { promptTokens: 321, completionTokens: 45, totalTokens: 366 };

/** How the fake service answers one request. */
type Script = (
  | { texts: string[]; outcome: ChatOutcome }
  /** Streams `texts`, then waits until the request is stopped. */
  | { texts: string[]; hang: true }
) & {
  /** The client says it retries after this many seconds, before any text. */
  retry?: number;
  /** The client says the service refused `stream_options` and took the request without it. */
  streamOptionsRejected?: true;
  /** Reasoning the model streams before its answer. */
  reasoning?: string[];
};

/** The panel's conversation over fakes of the background and the model service. */
function harness(options: {
  scripts?: Script[];
  saved?: SnapshotView | Error | (() => Promise<SnapshotView>);
  setup?: Partial<RunSetup> | Error;
  page?: PageContext;
  save?: (
    messages: SnapshotMessage[],
    revision: number,
  ) => Promise<{ truncated: boolean; stored?: boolean }>;
  choose?: (pick: ModelPick) => Promise<unknown>;
  choosePrompt?: (id: string) => Promise<unknown>;
  disableStreamUsage?: (id: string) => Promise<unknown>;
}) {
  const scripts = [...(options.scripts ?? [])];
  const requests: StreamRequest[] = [];
  const saves: SnapshotMessage[][] = [];
  const revisions: number[] = [];
  const events: PanelEvent[] = [];
  let state = INITIAL_PANEL_STATE;
  const extract = vi.fn(() => Promise.resolve(options.page ?? page));
  const choose = vi.fn(options.choose ?? (() => Promise.resolve({})));
  const choosePrompt = vi.fn(options.choosePrompt ?? (() => Promise.resolve({})));
  const disableStreamUsage = vi.fn(options.disableStreamUsage ?? (() => Promise.resolve({})));

  const conversation = createConversation({
    setup: () =>
      options.setup instanceof Error
        ? Promise.reject(options.setup)
        : Promise.resolve({
            choices: [
              { id: 'm1', name: '主力', model: 'm1-model', models: ['m1-model'] },
              { id: 'm2', name: '备用', model: 'm2-model', models: ['m2-model'] },
            ],
            config,
            prompt,
            prompts: [
              { id: 'p1', name: '网页总结' },
              { id: 'p2', name: '速读' },
            ],
            promptId: 'p1',
            trimming: 'back',
            answerLanguage: 'interface',
            autoSummarize: true,
            ...options.setup,
          }),
    restore: () =>
      typeof options.saved === 'function'
        ? options.saved()
        : options.saved instanceof Error
          ? Promise.reject(options.saved)
          : Promise.resolve(options.saved ?? { status: 'none' }),
    extract,
    stream: async (request) => {
      requests.push(request);
      const script = scripts.shift() ?? {
        texts: [],
        outcome: { kind: 'error', error: { kind: 'unknown', detail: 'unscripted' } },
      };
      if (script.retry !== undefined) request.onRetry({ seconds: script.retry });
      if (script.streamOptionsRejected === true) request.onStreamOptionsRejected();
      for (const text of script.reasoning ?? []) request.onReasoning(text);
      for (const text of script.texts) request.onText(text);
      if ('outcome' in script) return script.outcome;
      return new Promise<ChatOutcome>((resolve) => {
        request.signal.addEventListener('abort', () => resolve({ kind: 'stopped' }));
      });
    },
    save: async (messages, revision) => {
      saves.push(messages);
      revisions.push(revision);
      return options.save ? options.save(messages, revision) : { truncated: false };
    },
    choose,
    choosePrompt,
    disableStreamUsage,
    dispatch: (event) => {
      events.push(event);
      state = reducePanel(state, event);
    },
    language: (language) =>
      language.kind === 'interface'
        ? '简体中文'
        : language.kind === 'named'
          ? `named:${language.language}`
          : `tag:${language.tag}`,
    frame: (flush) => {
      flush();
      return () => {};
    },
  });

  return {
    conversation,
    requests,
    saves,
    revisions,
    events,
    extract,
    choose,
    choosePrompt,
    disableStreamUsage,
    state: () => state,
    /** The messages of request `index`, as sent. */
    sent: (index: number): ChatMessage[] => requests[index]?.messages ?? [],
  };
}

const done = (usage: Usage | null = reported): ChatOutcome => ({ kind: 'done', usage });
const answer = (text: string, outcome = done()): Script => ({ texts: [text], outcome });

/** Lets every pending promise callback run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('conversation: summary and follow-ups', () => {
  it('summarizes the page when nothing was saved for it, and saves the answer', async () => {
    const h = harness({ scripts: [answer('总结')] });

    await h.conversation.open();
    await settle();

    expect(h.sent(0)).toEqual([
      { role: 'system', content: '系统：用简体中文回答' },
      { role: 'user', content: '正文：页面正文。' },
    ]);
    expect(h.state()).toMatchObject({ phase: 'done', origin: 'https://api.example.com' });
    expect(h.state().turns).toMatchObject([{ question: null, text: '总结', status: 'done' }]);
    expect(h.saves).toEqual([
      [
        {
          role: 'assistant',
          content: '总结',
          stopped: false,
          usage: { source: 'service', input: 321, output: 45, total: 366 },
        },
      ],
    ]);
  });

  it("answers in the language the settings ask for, the page's own when they say so", async () => {
    const english = { ...page, lang: 'en-GB' };
    const h = harness({
      scripts: [answer('一'), answer('二')],
      page: english,
      setup: { answerLanguage: 'page' },
    });

    await h.conversation.open();
    await settle();
    expect(h.sent(0)[0]).toEqual({ role: 'system', content: '系统：用tag:en-GB回答' });

    const fixed = harness({
      scripts: [answer('一')],
      page: english,
      setup: { answerLanguage: 'ja' },
    });
    await fixed.conversation.open();
    await settle();
    expect(fixed.sent(0)[0]).toEqual({ role: 'system', content: '系统：用named:ja回答' });
  });

  it('asks a follow-up with the page, the conversation so far and the question', async () => {
    const h = harness({ scripts: [answer('总结'), answer('回答')] });
    await h.conversation.open();
    await settle();

    h.conversation.ask('  为什么？ ');
    await settle();

    expect(h.sent(1)).toEqual([
      { role: 'system', content: '系统：用简体中文回答' },
      { role: 'user', content: '正文：页面正文。' },
      { role: 'assistant', content: '总结' },
      { role: 'user', content: '为什么？' },
    ]);
    // The page is read again for every request: it is never stored.
    expect(h.extract).toHaveBeenCalledTimes(2);
    expect(h.state().turns.map((turn) => [turn.question, turn.text])).toEqual([
      [null, '总结'],
      ['为什么？', '回答'],
    ]);
    expect(h.saves.at(-1)?.map((message) => [message.role, message.content])).toEqual([
      ['assistant', '总结'],
      ['user', '为什么？'],
      ['assistant', '回答'],
    ]);
  });

  it('asks nothing before there is an answer, while one is coming, or when the question is blank', async () => {
    const h = harness({ scripts: [answer('总结'), { texts: ['回'], hang: true }] });

    h.conversation.ask('太早了');
    expect(h.requests).toHaveLength(0);

    await h.conversation.open();
    await settle();
    h.conversation.ask('   ');
    await settle();
    expect(h.requests).toHaveLength(1);

    h.conversation.ask('第一个问题');
    await settle();
    h.conversation.ask('正在回答时又问');
    await settle();
    expect(h.requests).toHaveLength(2);
    expect(h.state().turns.map((turn) => turn.question)).toEqual([null, '第一个问题']);
  });

  it('restores the saved conversation instead of summarizing, and follows up on it', async () => {
    const saved: SnapshotMessage[] = [
      { role: 'assistant', content: '旧总结', stopped: false, usage: null },
      { role: 'user', content: '旧问题' },
      { role: 'assistant', content: '旧回答', stopped: true, usage: null },
    ];
    const h = harness({
      saved: { status: 'found', messages: saved, truncated: false },
      scripts: [answer('新回答')],
    });

    await h.conversation.open();
    await settle();

    expect(h.requests).toHaveLength(0);
    expect(h.extract).not.toHaveBeenCalled();
    expect(h.state()).toMatchObject({ phase: 'restored', modelId: 'm1' });
    expect(h.state().models).toHaveLength(2);
    expect(h.state().turns.map((turn) => [turn.question, turn.text, turn.status])).toEqual([
      [null, '旧总结', 'done'],
      ['旧问题', '旧回答', 'stopped'],
    ]);

    h.conversation.ask('新问题');
    await settle();

    expect(h.extract).toHaveBeenCalledOnce();
    expect(h.sent(0).slice(2)).toEqual([
      { role: 'assistant', content: '旧总结' },
      { role: 'user', content: '旧问题' },
      { role: 'assistant', content: '旧回答' },
      { role: 'user', content: '新问题' },
    ]);
    expect(h.saves.at(-1)).toHaveLength(5);
  });

  it('says so when the saved conversation was evicted, then summarizes', async () => {
    const h = harness({ saved: { status: 'evicted' }, scripts: [answer('总结')] });

    await h.conversation.open();
    await settle();

    expect(h.requests).toHaveLength(1);
    expect(h.state().snapshot).toEqual({ kind: 'evicted' });
  });

  it('says so when the saved conversation cannot be read, then summarizes', async () => {
    const h = harness({
      saved: new Error('session storage unavailable'),
      scripts: [answer('总结')],
    });

    await h.conversation.open();
    await settle();

    expect(h.requests).toHaveLength(1);
    expect(h.state().snapshot).toEqual({
      kind: 'restore-failed',
      detail: 'session storage unavailable',
    });
  });

  it('starts over on a new summary: the conversation goes, and the next save replaces it', async () => {
    const h = harness({ scripts: [answer('总结'), answer('回答'), answer('新总结')] });
    await h.conversation.open();
    await settle();
    h.conversation.ask('问');
    await settle();

    h.conversation.summarize();
    await settle();

    expect(h.sent(2)).toHaveLength(2);
    expect(h.state().turns.map((turn) => turn.text)).toEqual(['新总结']);
    expect(h.saves.slice(2).map((saved) => saved.map((message) => message.content))).toEqual([
      [],
      ['新总结'],
    ]);
  });
});

describe('conversation: without summarizing on opening', () => {
  const off = { autoSummarize: false };

  it('waits for the user with the model menu filled, then summarizes when asked', async () => {
    const h = harness({ setup: off, scripts: [answer('总结')] });

    await h.conversation.open();
    await settle();

    expect(h.requests).toHaveLength(0);
    expect(h.extract).not.toHaveBeenCalled();
    expect(h.saves).toEqual([]);
    expect(h.state()).toMatchObject({ phase: 'ready', modelId: 'm1', turns: [] });
    expect(h.state().models).toHaveLength(2);

    h.conversation.summarize();
    await settle();

    expect(h.requests).toHaveLength(1);
    expect(h.state().turns.map((turn) => turn.text)).toEqual(['总结']);
    expect(h.saves).toEqual([[expect.objectContaining({ content: '总结' })]]);
  });

  it('still restores a saved conversation', async () => {
    const h = harness({
      setup: off,
      saved: {
        status: 'found',
        messages: [{ role: 'assistant', content: '旧总结', stopped: false, usage: null }],
        truncated: false,
      },
    });

    await h.conversation.open();
    await settle();

    expect(h.state().phase).toBe('restored');
    expect(h.state().turns.map((turn) => turn.text)).toEqual(['旧总结']);
  });

  it('still summarizes a selection right away: the user asked for that', async () => {
    const h = harness({
      setup: off,
      page: { ...page, selection: '选中的这一句。' },
      scripts: [answer('选区总结')],
    });

    await h.conversation.open('selection');
    await settle();

    expect(h.requests).toHaveLength(1);
    expect(h.state().turns.map((turn) => turn.text)).toEqual(['选区总结']);
  });

  it('only changes the default on a model pick while waiting', async () => {
    const h = harness({ setup: off, scripts: [answer('总结')] });
    await h.conversation.open();
    await settle();

    h.conversation.switchModel({ id: 'm2' });
    await settle();

    expect(h.choose).toHaveBeenCalledWith({ id: 'm2' });
    expect(h.requests).toHaveLength(0);
    expect(h.state()).toMatchObject({ phase: 'ready', modelId: 'm2' });
  });

  it('retries a failed pick while waiting without summarizing, and clears the failure (#27)', async () => {
    let refuse = true;
    const h = harness({
      setup: off,
      choose: () => (refuse ? Promise.reject(new Error('read-only')) : Promise.resolve({})),
    });
    await h.conversation.open();
    await settle();

    h.conversation.switchModel({ id: 'm2' });
    await settle();
    expect(h.state()).toMatchObject({ phase: 'error', problem: { kind: 'switch' } });

    refuse = false;
    h.conversation.retry();
    await settle();

    expect(h.requests).toHaveLength(0);
    expect(h.state()).toMatchObject({ phase: 'ready', modelId: 'm2', problem: null });
  });

  it('summarizes after a pick on its way, with the new default (#27)', async () => {
    let store: () => void = () => {};
    let chosen = 'm1';
    const h = harness({
      setup: off,
      scripts: [answer('总结')],
      choose: (pick) =>
        new Promise((resolve) => {
          store = () => {
            chosen = pick.id;
            resolve({});
          };
        }),
    });
    await h.conversation.open();
    await settle();

    h.conversation.switchModel({ id: 'm2' });
    h.conversation.summarize();
    await settle();
    expect(h.requests).toHaveLength(0);
    expect(h.state().phase).toBe('extracting');

    store();
    await settle();

    expect(chosen).toBe('m2');
    expect(h.requests).toHaveLength(1);
    expect(h.state().turns.map((turn) => turn.text)).toEqual(['总结']);
  });

  it('sends the model name picked under a configuration along with it', async () => {
    const h = harness({ setup: off, scripts: [answer('总结')] });
    await h.conversation.open();
    await settle();

    h.conversation.switchModel({ id: 'm2', model: 'm2-other' });
    await settle();

    expect(h.choose).toHaveBeenCalledWith({ id: 'm2', model: 'm2-other' });
    expect(h.state().models.find((choice) => choice.id === 'm2')?.model).toBe('m2-other');
  });

  it('goes ahead when the settings cannot be read, and reports why it could not run', async () => {
    const h = harness({ setup: new Error('background gone') });

    await h.conversation.open();
    await settle();

    expect(h.state()).toMatchObject({
      phase: 'error',
      problem: { kind: 'config', detail: 'background gone' },
    });
  });

  it('does not wait once the user started something meanwhile', async () => {
    let restore: (view: SnapshotView) => void = () => {};
    const h = harness({
      setup: off,
      saved: () => new Promise((resolve) => (restore = resolve)),
      scripts: [answer('总结')],
    });
    const opening = h.conversation.open();

    h.conversation.summarize();
    await settle();
    restore({ status: 'none' });
    await opening;
    await settle();

    expect(h.state().phase).toBe('done');
    expect(h.state().turns.map((turn) => turn.text)).toEqual(['总结']);
  });
});

describe('conversation: the selection (§4.6)', () => {
  const selected = { ...page, selection: '选中的这一句。' };
  const savedPage: SnapshotView = {
    status: 'found',
    messages: [{ role: 'assistant', content: '整页的总结', stopped: false, usage: null }],
    truncated: false,
  };

  it('summarizes the selection in place of the page, follows up on it, and saves nothing', async () => {
    const h = harness({
      page: selected,
      saved: savedPage,
      scripts: [answer('选区总结'), answer('追问回答')],
    });

    await h.conversation.open('selection');
    await settle();
    h.conversation.ask('为什么？');
    await settle();

    expect(h.state().mode).toBe('selection');
    expect(h.sent(0).at(-1)).toEqual({ role: 'user', content: '正文：选中的这一句。' });
    expect(h.sent(1).at(1)).toEqual({ role: 'user', content: '正文：选中的这一句。' });
    expect(h.state().turns.map((turn) => turn.text)).toEqual(['选区总结', '追问回答']);
    // The page's own conversation is neither shown nor replaced.
    expect(h.saves).toEqual([]);
  });

  it('says so when nothing was selected', async () => {
    const h = harness({ page, scripts: [answer('不该请求')] });

    await h.conversation.open('selection');
    await settle();

    expect(h.requests).toEqual([]);
    expect(h.state().problem).toEqual({ kind: 'empty-selection' });
  });

  it('gives a page summary the selection as {{selection}}', async () => {
    const h = harness({
      page: selected,
      setup: { prompt: { system: '', user: '{{content}}|{{selection}}' } },
      scripts: [answer('总结')],
    });

    await h.conversation.open();
    await settle();

    expect(h.sent(0)).toEqual([{ role: 'user', content: '页面正文。|选中的这一句。' }]);
  });
});

describe('conversation: one request at a time', () => {
  it('ends the request in flight when a new one starts, and shows nothing more of it', async () => {
    const h = harness({
      scripts: [
        { texts: ['旧的'], hang: true },
        { texts: ['新的'], hang: true },
      ],
    });
    await h.conversation.open();
    await settle();

    h.conversation.summarize();
    await settle();
    // A chunk the old request had already received arrives late, while the
    // new answer is still coming.
    h.requests[0]?.onText('迟到的');
    await settle();

    expect(h.requests[0]?.signal.aborted).toBe(true);
    expect(h.state()).toMatchObject({ phase: 'streaming' });
    expect(h.state().turns.map((turn) => turn.text)).toEqual(['新的']);
    h.conversation.stop();
    await settle();
    expect(h.saves).toEqual([
      [expect.objectContaining({ role: 'assistant', content: '新的', stopped: true })],
    ]);
  });

  it('marks an answer that did not end as a whole, and saves it as stopped (#28)', async () => {
    const h = harness({
      scripts: [{ texts: ['半截'], outcome: { kind: 'done', usage: null, ending: 'length' } }],
    });
    await h.conversation.open();
    await settle();

    expect(h.state()).toMatchObject({
      phase: 'done',
      turns: [{ text: '半截', status: 'done', ending: 'length' }],
    });
    expect(h.saves.at(-1)).toMatchObject([{ content: '半截', stopped: true }]);
  });

  it('keeps what arrived when stopped, and saves it as stopped with an estimate', async () => {
    const h = harness({ scripts: [{ texts: ['一半'], hang: true }] });
    await h.conversation.open();
    await settle();

    h.conversation.stop();
    await settle();

    expect(h.state().phase).toBe('stopped');
    const usage = {
      source: 'estimate',
      input: estimateMessages(h.sent(0)),
      output: estimateTokens('一半'),
    };
    expect(h.state().turns).toMatchObject([{ text: '一半', status: 'stopped', usage }]);
    expect(h.saves).toEqual([[{ role: 'assistant', content: '一半', stopped: true, usage }]]);
  });

  it('keeps nothing of a request stopped before any text, and runs it again on retry', async () => {
    const h = harness({ scripts: [{ texts: [], hang: true }, answer('总结')] });
    await h.conversation.open();
    await settle();
    h.conversation.stop();
    await settle();
    expect(h.saves).toHaveLength(0);

    h.conversation.retry();
    await settle();

    expect(h.state().turns.map((turn) => turn.text)).toEqual(['总结']);
  });

  it('stops at once while the page is read, and sends nothing afterwards (#23)', async () => {
    let read: (page: PageContext) => void = () => {};
    const h = harness({ scripts: [answer('总结')] });
    h.extract.mockImplementationOnce(() => new Promise((resolve) => (read = resolve)));
    await h.conversation.open();
    await settle();
    expect(h.state().phase).toBe('extracting');

    h.conversation.stop();
    expect(h.state()).toMatchObject({ phase: 'stopped', turns: [{ status: 'stopped' }] });
    read(page);
    await settle();

    expect(h.requests).toHaveLength(0);
    expect(h.events.some((event) => event.type === 'requesting')).toBe(false);
    expect(h.state().phase).toBe('stopped');
  });

  it('stops a model pick on its way: the pick is stored, nothing runs after it (#23)', async () => {
    let store: () => void = () => {};
    const h = harness({
      scripts: [answer('总结'), answer('不该有')],
      choose: () => new Promise((resolve) => (store = () => resolve({}))),
    });
    await h.conversation.open();
    await settle();

    h.conversation.switchModel({ id: 'm2' });
    h.conversation.stop();
    store();
    await settle();

    expect(h.choose).toHaveBeenCalledWith({ id: 'm2' });
    expect(h.requests).toHaveLength(1);
    // The summary on screen is still the summary it was.
    expect(h.state()).toMatchObject({
      phase: 'stopped',
      turns: [{ text: '总结', status: 'done' }],
    });
  });
});

describe('conversation: usage', () => {
  it("shows the service's figures when it reports them", async () => {
    const h = harness({ scripts: [answer('总结')] });
    await h.conversation.open();
    await settle();

    expect(h.state().turns[0]?.usage).toEqual({
      source: 'service',
      input: 321,
      output: 45,
      total: 366,
    });
  });

  it('estimates both sides when the service reports nothing', async () => {
    const h = harness({ scripts: [answer('一段回答', done(null))] });
    await h.conversation.open();
    await settle();

    expect(h.state().turns[0]?.usage).toEqual({
      source: 'estimate',
      input: estimateMessages(h.sent(0)),
      output: estimateTokens('一段回答'),
    });
  });
});

describe('conversation: the budget', () => {
  const longPage = { ...page, text: '字'.repeat(20_000) };

  it('cuts a page that does not fit the model, as the settings say, and tells the panel', async () => {
    const h = harness({
      page: longPage,
      setup: { config: { ...config, contextWindow: 4_096 }, trimming: 'back' },
      scripts: [answer('总结')],
    });
    await h.conversation.open();
    await settle();

    const sent = h.sent(0);
    expect(estimateMessages(sent)).toBeLessThanOrEqual(4_096 - outputReserve(4_096));
    expect(sent[1]?.content.endsWith(TRUNCATION_NOTE)).toBe(true);
    expect(h.state().turns[0]?.cut).toMatchObject({
      kind: 'budget',
      strategy: 'back',
      totalTokens: 20_000,
      contextWindow: 4_096,
      assumedWindow: false,
    });
  });

  it('notes a page that only extraction cut', async () => {
    const h = harness({ page: { ...page, truncated: true }, scripts: [answer('总结')] });
    await h.conversation.open();
    await settle();

    expect(h.state().turns[0]?.cut).toEqual({ kind: 'extraction' });
    expect(h.sent(0)[1]?.content.endsWith(TRUNCATION_NOTE)).toBe(true);
  });

  it('sends nothing when the conversation alone fills the window', async () => {
    const h = harness({
      saved: {
        status: 'found',
        messages: [{ role: 'assistant', content: '长'.repeat(5_000), stopped: false, usage: null }],
        truncated: false,
      },
      setup: { config: { ...config, contextWindow: 4_096 } },
    });
    await h.conversation.open();

    h.conversation.ask('还能问吗？');
    await settle();

    expect(h.requests).toHaveLength(0);
    expect(h.state().problem).toMatchObject({ kind: 'too-long', contextWindow: 4_096 });
    expect(h.state().turns.at(-1)).toMatchObject({ question: '还能问吗？', status: 'failed' });
  });

  it('offers to cut and retry when a page sent as it is was refused as too long', async () => {
    const refusal: LlmError = { kind: 'context-length', status: 400, detail: 'too long' };
    const h = harness({
      page: longPage,
      setup: { config: { ...config, contextWindow: 4_096 }, trimming: 'nothing' },
      scripts: [{ texts: [], outcome: { kind: 'error', error: refusal } }, answer('总结')],
    });
    await h.conversation.open();
    await settle();

    expect(h.sent(0)[1]?.content).toBe(`正文：${longPage.text}`);
    expect(h.state().problem).toEqual({ kind: 'llm', error: refusal, window: null });

    h.conversation.retry({ cut: true });
    await settle();

    expect(estimateMessages(h.sent(1))).toBeLessThanOrEqual(4_096 - outputReserve(4_096));
    expect(h.state().turns[0]?.cut).toMatchObject({ strategy: CUT_RETRY_STRATEGY });
    expect(h.state().phase).toBe('done');
  });

  it('tells a refusal of a budgeted request which window it was budgeted for', async () => {
    const refusal: LlmError = { kind: 'context-length', status: 400, detail: 'too long' };
    const h = harness({ scripts: [{ texts: [], outcome: { kind: 'error', error: refusal } }] });
    await h.conversation.open();
    await settle();

    expect(h.state().problem).toEqual({
      kind: 'llm',
      error: refusal,
      window: { contextWindow: 64_000, assumedWindow: true },
    });
  });
});

describe('conversation: failures', () => {
  it('runs a failed follow-up again with the same question', async () => {
    const h = harness({
      scripts: [
        answer('总结'),
        { texts: [], outcome: { kind: 'error', error: { kind: 'network', detail: 'offline' } } },
        answer('回答'),
      ],
    });
    await h.conversation.open();
    await settle();
    h.conversation.ask('问');
    await settle();
    expect(h.state()).toMatchObject({ phase: 'error', problem: { kind: 'llm' } });
    expect(h.saves).toHaveLength(1);

    h.conversation.retry();
    await settle();

    expect(h.sent(2).at(-1)).toEqual({ role: 'user', content: '问' });
    expect(h.state().turns.map((turn) => [turn.question, turn.text])).toEqual([
      [null, '总结'],
      ['问', '回答'],
    ]);
  });

  it('drops a failed follow-up when another question is asked', async () => {
    const h = harness({
      scripts: [
        answer('总结'),
        { texts: [], outcome: { kind: 'error', error: { kind: 'network', detail: 'offline' } } },
        answer('回答'),
      ],
    });
    await h.conversation.open();
    await settle();
    h.conversation.ask('问一');
    await settle();

    h.conversation.ask('问二');
    await settle();

    expect(h.sent(2).slice(2)).toEqual([
      { role: 'assistant', content: '总结' },
      { role: 'user', content: '问二' },
    ]);
    expect(h.state().turns.map((turn) => turn.question)).toEqual([null, '问二']);
  });

  it('keeps nothing of an empty answer, and says so', async () => {
    const h = harness({ scripts: [{ texts: [], outcome: done() }] });
    await h.conversation.open();
    await settle();

    expect(h.state().problem).toEqual({ kind: 'empty-answer' });
    expect(h.saves).toHaveLength(0);
  });

  it('shows a failed save in the panel, and clears it once a save goes through', async () => {
    let refuse = true;
    const h = harness({
      scripts: [answer('总结'), answer('回答')],
      save: () =>
        refuse ? Promise.reject(new Error('quota')) : Promise.resolve({ truncated: false }),
    });
    await h.conversation.open();
    await settle();
    expect(h.state().snapshot).toEqual({ kind: 'save-failed', detail: 'quota' });
    expect(h.state().turns[0]?.text).toBe('总结');

    refuse = false;
    h.conversation.ask('问');
    await settle();

    expect(h.state().snapshot).toBeNull();
  });

  it('takes a save the background did not store as saying nothing about the copy (#29)', async () => {
    let reply: { truncated: boolean; stored?: boolean } | Error = new Error('quota');
    const h = harness({
      scripts: [answer('总结'), answer('回答')],
      save: () => (reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply)),
    });
    await h.conversation.open();
    await settle();
    expect(h.state().snapshot).toMatchObject({ kind: 'save-failed' });

    reply = { truncated: false, stored: false };
    h.conversation.ask('问');
    await settle();

    expect(h.state().snapshot).toMatchObject({ kind: 'save-failed' });
  });

  it('says when the saved copy had to leave out the oldest messages', async () => {
    const h = harness({
      scripts: [answer('总结')],
      save: () => Promise.resolve({ truncated: true }),
    });
    await h.conversation.open();
    await settle();

    expect(h.state().snapshot).toEqual({ kind: 'save-truncated' });
  });

  it('does nothing more once disposed', async () => {
    const h = harness({ scripts: [answer('总结')] });
    const opening = h.conversation.open();
    h.conversation.dispose();
    await opening;
    await settle();

    expect(h.requests).toHaveLength(0);
    expect(h.events).toEqual([]);
  });
});

describe('conversation: the model menu', () => {
  it('makes the pick the default, then answers the latest question again with it', async () => {
    const h = harness({ scripts: [answer('总结'), answer('回答'), answer('另一个模型的回答')] });
    await h.conversation.open();
    await settle();
    h.conversation.ask('问');
    await settle();

    h.conversation.switchModel({ id: 'm2' });
    await settle();

    expect(h.choose).toHaveBeenCalledWith({ id: 'm2' });
    expect(h.sent(2).slice(2)).toEqual([
      { role: 'assistant', content: '总结' },
      { role: 'user', content: '问' },
    ]);
    expect(h.state().turns.map((turn) => [turn.question, turn.text])).toEqual([
      [null, '总结'],
      ['问', '另一个模型的回答'],
    ]);
  });

  it('summarizes again with the pick when the summary is all there is', async () => {
    const h = harness({ scripts: [{ texts: ['旧的'], hang: true }, answer('新的')] });
    await h.conversation.open();
    await settle();

    h.conversation.switchModel({ id: 'm2' });
    await settle();

    expect(h.requests[0]?.signal.aborted).toBe(true);
    expect(h.sent(1)).toHaveLength(2);
    expect(h.state().turns.map((turn) => turn.text)).toEqual(['新的']);
  });

  it('reports a pick that could not be stored', async () => {
    const h = harness({
      scripts: [answer('总结')],
      choose: () => Promise.reject(new Error('read-only')),
    });
    await h.conversation.open();
    await settle();

    h.conversation.switchModel({ id: 'm2' });
    await settle();

    expect(h.state()).toMatchObject({
      phase: 'error',
      problem: { kind: 'switch', detail: 'read-only' },
    });
    expect(h.requests).toHaveLength(1);
  });

  it('puts the menu back on the stored default when a pick fails, and retries the pick (#27)', async () => {
    let refuse = true;
    const h = harness({
      scripts: [answer('总结'), answer('另一个模型的总结')],
      choose: () => (refuse ? Promise.reject(new Error('read-only')) : Promise.resolve({})),
    });
    await h.conversation.open();
    await settle();

    h.conversation.switchModel({ id: 'm2' });
    await settle();
    expect(h.state()).toMatchObject({ modelId: 'm1', problem: { kind: 'switch' } });

    refuse = false;
    h.conversation.retry();
    await settle();

    expect(h.choose).toHaveBeenCalledTimes(2);
    expect(h.choose).toHaveBeenLastCalledWith({ id: 'm2' });
    expect(h.requests).toHaveLength(2);
    expect(h.state()).toMatchObject({ phase: 'done', problem: null });
  });
});

describe('conversation: the prompt menu', () => {
  it('fills the menu with the prompt names and the default', async () => {
    const h = harness({ scripts: [answer('总结')] });
    await h.conversation.open();
    await settle();

    expect(h.state()).toMatchObject({
      prompts: [
        { id: 'p1', name: '网页总结' },
        { id: 'p2', name: '速读' },
      ],
      promptId: 'p1',
    });
  });

  it('makes the pick the default, then starts over with a new summary', async () => {
    const h = harness({ scripts: [answer('总结'), answer('回答'), answer('速读的总结')] });
    await h.conversation.open();
    await settle();
    h.conversation.ask('问');
    await settle();

    h.conversation.switchPrompt('p2');
    await settle();

    expect(h.choosePrompt).toHaveBeenCalledWith('p2');
    expect(h.sent(2)).toHaveLength(2);
    expect(h.state()).toMatchObject({ phase: 'done' });
    expect(h.state().turns.map((turn) => [turn.question, turn.text])).toEqual([
      [null, '速读的总结'],
    ]);
    // The conversation saved for the page is the new summary alone.
    expect(h.saves.at(-1)).toMatchObject([{ role: 'assistant', content: '速读的总结' }]);
  });

  it('only changes the default while the panel waits for the user to ask', async () => {
    const h = harness({ setup: { autoSummarize: false } });
    await h.conversation.open();
    await settle();

    h.conversation.switchPrompt('p2');
    await settle();

    expect(h.choosePrompt).toHaveBeenCalledWith('p2');
    expect(h.requests).toHaveLength(0);
    expect(h.state()).toMatchObject({ phase: 'ready', promptId: 'p2' });
  });

  it('waits for both picks, then starts over once with the new prompt and model', async () => {
    let storePrompt: () => void = () => {};
    const h = harness({
      scripts: [answer('总结'), answer('新的')],
      choosePrompt: () => new Promise((resolve) => (storePrompt = () => resolve({}))),
    });
    await h.conversation.open();
    await settle();

    h.conversation.switchPrompt('p2');
    h.conversation.switchModel({ id: 'm2' });
    await settle();
    // The model is stored, the prompt not yet: nothing runs.
    expect(h.requests).toHaveLength(1);

    storePrompt();
    await settle();

    expect(h.requests).toHaveLength(2);
    expect(h.state().turns.map((turn) => turn.text)).toEqual(['新的']);
  });

  it('reports a pick that could not be stored, and keeps the conversation', async () => {
    const h = harness({
      scripts: [answer('总结')],
      choosePrompt: () => Promise.reject(new Error('read-only')),
    });
    await h.conversation.open();
    await settle();

    h.conversation.switchPrompt('p2');
    await settle();

    expect(h.state()).toMatchObject({
      phase: 'error',
      problem: { kind: 'switch', detail: 'read-only' },
    });
    expect(h.requests).toHaveLength(1);
    expect(h.saves).toHaveLength(1);
  });

  it('goes no further with a prompt pick stored after the user asked something else', async () => {
    let stored: () => void = () => {};
    const h = harness({
      scripts: [answer('总结'), answer('重新的总结')],
      choosePrompt: () => new Promise((resolve) => (stored = () => resolve({}))),
    });
    await h.conversation.open();
    await settle();
    h.conversation.switchPrompt('p2');
    await settle();

    h.conversation.summarize();
    await settle();
    stored();
    await settle();

    expect(h.requests).toHaveLength(2);
    expect(h.state().turns.map((turn) => turn.text)).toEqual(['重新的总结']);
  });
});

describe('saved messages and turns', () => {
  it('round-trip, each answer with the question before it', () => {
    const exchanges = [
      { question: null, answer: '总结', stopped: false, usage: null },
      { question: '问', answer: '答', stopped: true, usage: null },
    ];
    expect(toExchanges(toSnapshotMessages(exchanges))).toEqual(exchanges);
  });

  it('read an answer whose question was left out as one without a question', () => {
    expect(
      toExchanges([{ role: 'assistant', content: '答', stopped: false, usage: null }]),
    ).toEqual([{ question: null, answer: '答', stopped: false, usage: null }]);
  });

  it('cut a message longer than a snapshot keeps, and save a cut answer as stopped', () => {
    const long = 'a'.repeat(SNAPSHOT_MESSAGE_LENGTH + 1);
    const messages = toSnapshotMessages([
      { question: long, answer: long, stopped: false, usage: null },
    ]);

    expect(messages.map((message) => message.content.length)).toEqual([
      SNAPSHOT_MESSAGE_LENGTH,
      SNAPSHOT_MESSAGE_LENGTH,
    ]);
    expect(messages[1]).toMatchObject({ role: 'assistant', stopped: true });
    expect(z.array(SnapshotMessage).safeParse(messages).success).toBe(true);
  });

  it('cut an answer to what fits a page snapshot in bytes, between characters', () => {
    const long = '汉'.repeat(150_000) + '😀'.repeat(50_000);
    const content = savedText(long);

    expect(content.length).toBeLessThan(long.length);
    expect(long.startsWith(content)).toBe(true);
    expect(content).not.toMatch(/[\ud800-\udbff]$/);
    const snapshot = fitPage(
      'https://example.com/post',
      [{ role: 'assistant', content, stopped: true, usage: null }],
      0,
      SNAPSHOT_PAGE_BYTES,
    );
    expect(snapshot?.snapshot.truncated).toBe(false);
    expect(savedText('短回答')).toBe('短回答');
  });
});

describe('conversation: what goes on after the user moved on (PR #4 review)', () => {
  const oldSummary: SnapshotView = {
    status: 'found',
    messages: [{ role: 'assistant', content: '旧总结', stopped: false, usage: null }],
    truncated: false,
  };

  it('shows nothing about a save answered after the panel went away', async () => {
    let answerSave: (result: { truncated: boolean }) => void = () => {};
    const h = harness({
      scripts: [answer('总结')],
      save: () => new Promise((resolve) => (answerSave = resolve)),
    });
    await h.conversation.open();
    await settle();
    const seen = h.events.length;

    h.conversation.dispose();
    answerSave({ truncated: true });
    await settle();

    expect(h.saves).toHaveLength(1);
    expect(h.events).toHaveLength(seen);
  });

  it('shows nothing about a save that fails after the panel went away', async () => {
    let failSave: (error: Error) => void = () => {};
    const h = harness({
      scripts: [answer('总结')],
      save: () => new Promise((_, reject) => (failSave = reject)),
    });
    await h.conversation.open();
    await settle();
    const seen = h.events.length;

    h.conversation.dispose();
    failSave(new Error('quota'));
    await settle();

    expect(h.events).toHaveLength(seen);
  });

  it('goes no further with a model pick stored after the panel went away', async () => {
    let stored: () => void = () => {};
    const h = harness({
      scripts: [answer('总结'), answer('不该出现')],
      choose: () => new Promise((resolve) => (stored = () => resolve({}))),
    });
    await h.conversation.open();
    await settle();
    h.conversation.switchModel({ id: 'm2' });
    await settle();
    const seen = h.events.length;

    h.conversation.dispose();
    stored();
    await settle();

    expect(h.requests).toHaveLength(1);
    expect(h.events).toHaveLength(seen);
  });

  it('reports nothing about a model pick that failed after the panel went away', async () => {
    let refuse: (error: Error) => void = () => {};
    const h = harness({
      scripts: [answer('总结')],
      choose: () => new Promise((_, reject) => (refuse = reject)),
    });
    await h.conversation.open();
    await settle();
    h.conversation.switchModel({ id: 'm2' });
    await settle();
    const seen = h.events.length;

    h.conversation.dispose();
    refuse(new Error('read-only'));
    await settle();

    expect(h.events).toHaveLength(seen);
  });

  it('does not let a restore that was still waiting replace a summary started meanwhile', async () => {
    let restore: (view: SnapshotView) => void = () => {};
    const h = harness({
      saved: () => new Promise((resolve) => (restore = resolve)),
      scripts: [answer('新总结')],
    });
    const opening = h.conversation.open();

    h.conversation.summarize();
    await settle();
    restore(oldSummary);
    await opening;
    await settle();

    expect(h.events.some((event) => event.type === 'restored')).toBe(false);
    expect(h.requests).toHaveLength(1);
    expect(h.state().turns.map((turn) => turn.text)).toEqual(['新总结']);
    expect(h.saves).toEqual([[expect.objectContaining({ content: '新总结' })]]);
  });

  it('lets a second open replace the first', async () => {
    const restores: ((view: SnapshotView) => void)[] = [];
    const h = harness({
      saved: () => new Promise((resolve) => restores.push(resolve)),
      scripts: [answer('总结')],
    });
    const first = h.conversation.open();
    const second = h.conversation.open();

    restores[1]?.({ status: 'none' });
    await second;
    await settle();
    restores[0]?.(oldSummary);
    await first;
    await settle();

    expect(h.events.some((event) => event.type === 'restored')).toBe(false);
    expect(h.requests).toHaveLength(1);
    expect(h.state().turns.map((turn) => turn.text)).toEqual(['总结']);
  });

  it('saves the emptied conversation as soon as the user starts over, newer than every save before', async () => {
    const h = harness({ scripts: [answer('总结'), answer('回答'), { texts: ['新'], hang: true }] });
    await h.conversation.open();
    await settle();
    h.conversation.ask('问');
    await settle();
    expect(h.revisions).toEqual([1, 2]);

    h.conversation.summarize();
    await settle();

    // The new summary is still coming; the old conversation is no longer what is saved.
    expect(h.saves.at(-1)).toEqual([]);
    expect(h.revisions).toEqual([1, 2, 3]);
  });

  it('saves the conversation without the turn it answers again, as soon as it starts', async () => {
    const h = harness({ scripts: [answer('总结'), answer('回答'), { texts: [], hang: true }] });
    await h.conversation.open();
    await settle();
    h.conversation.ask('问');
    await settle();

    h.conversation.retry();
    await settle();

    expect(h.saves.at(-1)?.map((message) => message.content)).toEqual(['总结']);
    expect(h.revisions).toEqual([1, 2, 3]);
  });

  it('shows only what the newest save reports, whatever order the answers come in', async () => {
    const answers: {
      resolve: (result: { truncated: boolean }) => void;
      reject: (error: Error) => void;
    }[] = [];
    const h = harness({
      scripts: [answer('总结'), answer('回答')],
      save: () => new Promise((resolve, reject) => answers.push({ resolve, reject })),
    });
    await h.conversation.open();
    await settle();
    h.conversation.ask('问');
    await settle();

    answers[1]?.resolve({ truncated: false });
    await settle();
    answers[0]?.reject(new Error('quota'));
    await settle();

    expect(h.state().snapshot).toBeNull();
  });
});

describe('conversation: what the client does on its own (§4.5)', () => {
  it('shows that it tries once more while it waits, then shows the answer', async () => {
    const h = harness({ scripts: [{ ...answer('总结'), retry: 3 }] });
    await h.conversation.open();
    await settle();

    const retrying = h.events.findIndex((event) => event.type === 'retrying');
    expect(h.events[retrying]).toEqual({ type: 'retrying', seconds: 3 });
    const waiting = h.events.slice(0, retrying + 1).reduce(reducePanel, INITIAL_PANEL_STATE);
    expect(waiting).toMatchObject({ phase: 'requesting', retrying: 3 });
    expect(h.state()).toMatchObject({ phase: 'done', retrying: null });
  });

  it('says nothing of a retry for a request the user has replaced', async () => {
    const h = harness({ scripts: [{ texts: [], hang: true }, answer('新总结')] });
    await h.conversation.open();
    await settle();
    h.conversation.summarize();
    await settle();

    h.requests[0]?.onRetry({ seconds: 2 });

    expect(h.events.some((event) => event.type === 'retrying')).toBe(false);
    expect(h.state()).toMatchObject({ phase: 'done', retrying: null });
  });

  it('remembers for the model that its service refused stream_options', async () => {
    const h = harness({ scripts: [{ ...answer('总结'), streamOptionsRejected: true }] });
    await h.conversation.open();
    await settle();

    expect(h.disableStreamUsage).toHaveBeenCalledExactlyOnceWith('m1');
    expect(h.state().phase).toBe('done');
  });

  it('shows nothing when remembering that fails: the next request finds out again', async () => {
    const h = harness({
      scripts: [{ ...answer('总结'), streamOptionsRejected: true }],
      disableStreamUsage: () => Promise.reject(new Error('read-only')),
    });
    await h.conversation.open();
    await settle();

    expect(h.state()).toMatchObject({ phase: 'done', problem: null, snapshot: null });
  });
});

describe('conversation: reasoning (§4.5, decision 3)', () => {
  it('shows the reasoning folded apart from the answer, and never saves or sends it again', async () => {
    const h = harness({
      scripts: [
        { texts: ['总结'], outcome: done(null), reasoning: ['先想', '一想'] },
        answer('回答'),
      ],
    });
    await h.conversation.open();
    await settle();

    expect(h.state().turns).toMatchObject([{ text: '总结', reasoning: '先想一想' }]);
    expect(h.saves.at(-1)).toMatchObject([{ role: 'assistant', content: '总结', stopped: false }]);
    expect(JSON.stringify(h.saves)).not.toContain('先想');

    h.conversation.ask('问题');
    await settle();
    expect(JSON.stringify(h.sent(1))).not.toContain('先想');
  });

  it('counts reasoning as output when it estimates the usage', async () => {
    const h = harness({
      scripts: [{ texts: ['答'], outcome: done(null), reasoning: ['想'.repeat(300)] }],
    });
    await h.conversation.open();
    await settle();

    const usage = h.state().turns[0]?.usage;
    expect(usage).toMatchObject({ source: 'estimate' });
    expect(usage?.source === 'estimate' && usage.output).toBe(
      estimateTokens(`${'想'.repeat(300)}答`),
    );
  });

  it('does not take reasoning alone for an answer', async () => {
    const h = harness({ scripts: [{ texts: [], outcome: done(null), reasoning: ['想了半天'] }] });
    await h.conversation.open();
    await settle();

    expect(h.state()).toMatchObject({ phase: 'error', problem: { kind: 'empty-answer' } });
    expect(h.saves).toEqual([]);
  });
});
