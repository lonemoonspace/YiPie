import { describe, expect, it } from 'vitest';
import {
  INITIAL_PANEL_STATE,
  canAsk,
  isBusy,
  modelName,
  reducePanel,
  type PanelEvent,
  type PanelState,
} from '@/features/panel/state';

const play = (events: PanelEvent[], from: PanelState = INITIAL_PANEL_STATE) =>
  events.reduce(reducePanel, from);

const summary: PanelEvent = { type: 'start', question: null, keep: 0 };

const requesting: PanelEvent = {
  type: 'requesting',
  origin: 'http://localhost:11434',
  cut: {
    kind: 'budget',
    strategy: 'back',
    keptTokens: 2_000,
    totalTokens: 9_000,
    contextWindow: 4_096,
    assumedWindow: false,
  },
};

const menu: PanelEvent = {
  type: 'models',
  models: [
    { id: 'q', name: 'qwen' },
    { id: 'd', name: 'deepseek' },
  ],
  modelId: 'q',
};

const usage = { source: 'service', input: 10, output: 5, total: 15 } as const;

/** A summary that finished with `text`. */
const answered = (text: string): PanelEvent[] => [
  summary,
  menu,
  requesting,
  { type: 'text', text },
  { type: 'finished', usage },
];

describe('reducePanel: one run', () => {
  it('walks a summary from start to done', () => {
    const states = [
      summary,
      menu,
      requesting,
      { type: 'text', text: '## 概要' },
      { type: 'text', text: '\n\n要点' },
      { type: 'finished', usage },
    ].reduce<PanelState[]>(
      (seen, event) => [
        ...seen,
        reducePanel(seen.at(-1) ?? INITIAL_PANEL_STATE, event as PanelEvent),
      ],
      [],
    );

    expect(states.map((state) => state.phase)).toEqual([
      'extracting',
      'extracting',
      'requesting',
      'streaming',
      'streaming',
      'done',
    ]);
    const done = states.at(-1) ?? INITIAL_PANEL_STATE;
    expect(modelName(done)).toBe('qwen');
    expect(done.turns).toEqual([
      {
        question: null,
        text: '## 概要\n\n要点',
        reasoning: '',
        status: 'done',
        usage,
        cut: requesting.type === 'requesting' ? requesting.cut : null,
      },
    ]);
    expect(done.problem).toBeNull();
  });

  it('keeps reasoning apart from the answer, and says the model is thinking until it answers', () => {
    const thinking = play([
      summary,
      requesting,
      { type: 'reasoning', text: '先想' },
      { type: 'reasoning', text: '一想' },
    ]);
    expect(thinking.phase).toBe('streaming');
    expect(thinking.turns).toMatchObject([{ text: '', reasoning: '先想一想' }]);

    const answering = play([{ type: 'text', text: '答' }], thinking);
    expect(answering.turns).toMatchObject([{ text: '答', reasoning: '先想一想' }]);
    // Reasoning that comes after a stop changes nothing.
    const stopped = play([{ type: 'stopped', usage: null }], answering);
    expect(play([{ type: 'reasoning', text: '迟到' }], stopped)).toBe(stopped);
  });

  it('keeps the text when stopped, and ignores chunks that arrive afterwards', () => {
    const state = play([
      summary,
      requesting,
      { type: 'text', text: '一半' },
      { type: 'stopped', usage: null },
      { type: 'text', text: '迟到' },
      { type: 'finished', usage },
    ]);
    expect(state.phase).toBe('stopped');
    expect(state.turns).toMatchObject([{ text: '一半', status: 'stopped', usage: null }]);
  });

  it('keeps the text when the model fails mid-answer, and marks the turn failed', () => {
    const state = play([
      summary,
      requesting,
      { type: 'text', text: '部分' },
      {
        type: 'failed',
        problem: { kind: 'llm', error: { kind: 'server', detail: 'boom' }, window: null },
      },
    ]);
    expect(state).toMatchObject({ phase: 'error', problem: { kind: 'llm' } });
    expect(state.turns).toMatchObject([{ text: '部分', status: 'failed' }]);
  });

  it('shows the automatic retry while the request waits, and forgets it once text comes', () => {
    const waiting = play([summary, requesting, { type: 'retrying', seconds: 3 }]);
    expect(waiting).toMatchObject({ phase: 'requesting', retrying: 3 });

    expect(play([{ type: 'text', text: '好' }], waiting)).toMatchObject({
      phase: 'streaming',
      retrying: null,
    });
    expect(
      play(
        [
          {
            type: 'failed',
            problem: { kind: 'llm', error: { kind: 'server', detail: '' }, window: null },
          },
        ],
        waiting,
      ),
    ).toMatchObject({ phase: 'error', retrying: null });
  });

  it('ignores a retry reported when no request is waiting', () => {
    const finished = play(answered('答'));
    expect(play([{ type: 'retrying', seconds: 2 }], finished)).toBe(finished);
  });

  it('keeps the model menu across runs, so it does not flicker', () => {
    const done = play(answered('答'));
    expect(play([summary], done)).toMatchObject({
      phase: 'extracting',
      models: [{ id: 'q' }, { id: 'd' }],
      modelId: 'q',
    });
  });

  it('names no model before the menu is known', () => {
    expect(modelName(INITIAL_PANEL_STATE)).toBe('');
  });

  it('knows when a request is in flight', () => {
    expect(isBusy(play([summary]))).toBe(true);
    expect(isBusy(play([summary, requesting, { type: 'stopped', usage: null }]))).toBe(false);
    expect(isBusy(play(answered('答')))).toBe(false);
  });
});

describe('reducePanel: a conversation', () => {
  it('adds a follow-up after the turns it keeps', () => {
    const state = play(
      [
        { type: 'start', question: '为什么？', keep: 1 },
        { type: 'text', text: '没开始' },
      ],
      play(answered('总结')),
    );

    expect(state.turns.map((turn) => [turn.question, turn.text, turn.status])).toEqual([
      [null, '总结', 'done'],
      ['为什么？', '', 'pending'],
    ]);
    // Text before the request is under way is not an answer.
    expect(state.phase).toBe('extracting');
  });

  it('replaces the turns it does not keep: a failed one, or the one being redone', () => {
    const failed = play(
      [
        { type: 'start', question: '问一', keep: 1 },
        { type: 'failed', problem: { kind: 'extract', detail: 'gone' } },
      ],
      play(answered('总结')),
    );
    const again = play([{ type: 'start', question: '问二', keep: 1 }], failed);

    expect(again.turns.map((turn) => turn.question)).toEqual([null, '问二']);
    expect(again.problem).toBeNull();
    expect(play([summary], again).turns).toHaveLength(1);
  });

  it('shows a restored conversation as it was saved', () => {
    const state = play([
      {
        type: 'restored',
        exchanges: [
          { question: null, answer: '总结', stopped: false, usage },
          { question: '追问', answer: '半截', stopped: true, usage: null },
        ],
        truncated: true,
      },
    ]);

    expect(state.phase).toBe('restored');
    expect(isBusy(state)).toBe(false);
    expect(state.turns).toEqual([
      // Reasoning is never saved: a restored turn has none.
      { question: null, text: '总结', reasoning: '', status: 'done', usage, cut: null },
      { question: '追问', text: '半截', reasoning: '', status: 'stopped', usage: null, cut: null },
    ]);
    expect(state.snapshot).toEqual({ kind: 'restored-truncated' });
  });

  it('lets the user ask only once there is an answer and nothing is in flight', () => {
    expect(canAsk(INITIAL_PANEL_STATE)).toBe(false);
    expect(canAsk(play([summary]))).toBe(false);
    expect(canAsk(play([summary, { type: 'failed', problem: { kind: 'no-model' } }]))).toBe(false);
    expect(canAsk(play([summary, requesting, { type: 'stopped', usage: null }]))).toBe(false);
    expect(canAsk(play(answered('总结')))).toBe(true);
    expect(canAsk(play([{ type: 'start', question: '问', keep: 1 }], play(answered('总结'))))).toBe(
      false,
    );
  });

  it('marks the panel busy for a model picked from the menu, until the turn starts again', () => {
    const picked = play([{ type: 'select', modelId: 'd' }], play(answered('总结')));

    expect(picked).toMatchObject({ phase: 'extracting', modelId: 'd', problem: null });
    expect(modelName(picked)).toBe('deepseek');
    expect(picked.turns).toHaveLength(1);
  });

  it('stays ready for a model picked before the first summary', () => {
    const picked = play([{ type: 'ready' }, { type: 'select', modelId: 'd', waiting: true }]);

    expect(picked).toMatchObject({ phase: 'ready', modelId: 'd', turns: [] });
    expect(isBusy(picked)).toBe(false);
    expect(canAsk(picked)).toBe(false);
  });

  it('leaves a finished turn alone when the menu then fails', () => {
    const state = play(
      [
        { type: 'select', modelId: 'd' },
        { type: 'failed', problem: { kind: 'switch', detail: 'read-only' } },
      ],
      play(answered('总结')),
    );

    expect(state.phase).toBe('error');
    expect(state.turns).toMatchObject([{ status: 'done' }]);
  });
});

describe('reducePanel: the saved copy', () => {
  it('keeps a saving problem until a later save goes through in full', () => {
    const failed = play([{ type: 'snapshot', note: { kind: 'save-failed', detail: 'quota' } }]);
    expect(failed.snapshot).toEqual({ kind: 'save-failed', detail: 'quota' });
    expect(play([{ type: 'saved' }], failed).snapshot).toBeNull();

    const shortened = play([{ type: 'snapshot', note: { kind: 'save-truncated' } }]);
    expect(play([{ type: 'saved' }], shortened).snapshot).toBeNull();
  });

  it('keeps what it said about the conversation it found when a save goes through', () => {
    const evicted = play([{ type: 'snapshot', note: { kind: 'evicted' } }]);
    expect(play([{ type: 'saved' }], evicted).snapshot).toEqual({ kind: 'evicted' });
  });
});
