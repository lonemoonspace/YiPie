import { describe, expect, it, vi } from 'vitest';
import type { PageContext } from '@/contract/page-context';
import type { PanelModelConfig, SnapshotView } from '@/contract/rpc';
import type { SnapshotMessage } from '@/contract/snapshot';
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
  toSnapshotMessages,
  type RunSetup,
  type StreamRequest,
} from '@/features/panel/conversation';
import { INITIAL_PANEL_STATE, reducePanel, type PanelEvent } from '@/features/panel/state';
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
  truncated: false,
};

const reported: Usage = { promptTokens: 321, completionTokens: 45, totalTokens: 366 };

/** How the fake service answers one request. */
type Script =
  | { texts: string[]; outcome: ChatOutcome }
  /** Streams `texts`, then waits until the request is stopped. */
  | { texts: string[]; hang: true };

/** The panel's conversation over fakes of the background and the model service. */
function harness(options: {
  scripts?: Script[];
  saved?: SnapshotView | Error;
  setup?: Partial<RunSetup>;
  page?: PageContext;
  save?: (messages: SnapshotMessage[]) => Promise<{ truncated: boolean }>;
  choose?: (id: string) => Promise<unknown>;
}) {
  const scripts = [...(options.scripts ?? [])];
  const requests: StreamRequest[] = [];
  const saves: SnapshotMessage[][] = [];
  const events: PanelEvent[] = [];
  let state = INITIAL_PANEL_STATE;
  const extract = vi.fn(() => Promise.resolve(options.page ?? page));
  const choose = vi.fn(options.choose ?? (() => Promise.resolve({})));

  const conversation = createConversation({
    setup: () =>
      Promise.resolve({
        choices: [
          { id: 'm1', name: '主力' },
          { id: 'm2', name: '备用' },
        ],
        config,
        prompt,
        trimming: 'back',
        ...options.setup,
      }),
    restore: () =>
      options.saved instanceof Error
        ? Promise.reject(options.saved)
        : Promise.resolve(options.saved ?? { status: 'none' }),
    extract,
    stream: async (request) => {
      requests.push(request);
      const script = scripts.shift() ?? {
        texts: [],
        outcome: { kind: 'error', error: { kind: 'unknown', detail: 'unscripted' } },
      };
      for (const text of script.texts) request.onText(text);
      if ('outcome' in script) return script.outcome;
      return new Promise<ChatOutcome>((resolve) => {
        request.signal.addEventListener('abort', () => resolve({ kind: 'stopped' }));
      });
    },
    save: async (messages) => {
      saves.push(messages);
      return options.save ? options.save(messages) : { truncated: false };
    },
    choose,
    dispatch: (event) => {
      events.push(event);
      state = reducePanel(state, event);
    },
    language: '简体中文',
    frame: (flush) => {
      flush();
      return () => {};
    },
  });

  return {
    conversation,
    requests,
    saves,
    events,
    extract,
    choose,
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
    expect(h.saves.at(-1)?.map((message) => message.content)).toEqual(['新总结']);
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

    h.conversation.switchModel('m2');
    await settle();

    expect(h.choose).toHaveBeenCalledWith('m2');
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

    h.conversation.switchModel('m2');
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

    h.conversation.switchModel('m2');
    await settle();

    expect(h.state()).toMatchObject({
      phase: 'error',
      problem: { kind: 'switch', detail: 'read-only' },
    });
    expect(h.requests).toHaveLength(1);
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
});
