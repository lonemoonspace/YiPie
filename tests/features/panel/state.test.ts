import { describe, expect, it } from 'vitest';
import {
  INITIAL_PANEL_STATE,
  isBusy,
  reducePanel,
  type PanelEvent,
  type PanelState,
} from '@/features/panel/state';

const play = (events: PanelEvent[], from: PanelState = INITIAL_PANEL_STATE) =>
  events.reduce(reducePanel, from);

const requesting: PanelEvent = {
  type: 'requesting',
  model: 'qwen',
  origin: 'http://localhost:11434',
  truncated: true,
};

describe('reducePanel', () => {
  it('walks a summary from start to done', () => {
    const states = [
      { type: 'start' },
      requesting,
      { type: 'text', text: '## 概要' },
      { type: 'text', text: '\n\n要点' },
      { type: 'finished', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } },
    ].reduce<PanelState[]>(
      (seen, event) => [
        ...seen,
        reducePanel(seen.at(-1) ?? INITIAL_PANEL_STATE, event as PanelEvent),
      ],
      [],
    );

    expect(states.map((state) => state.phase)).toEqual([
      'extracting',
      'requesting',
      'streaming',
      'streaming',
      'done',
    ]);
    expect(states.at(-1)).toMatchObject({
      model: 'qwen',
      truncated: true,
      text: '## 概要\n\n要点',
      usage: { totalTokens: 15 },
      problem: null,
    });
  });

  it('keeps the text when stopped, and ignores chunks that arrive afterwards', () => {
    const state = play([
      { type: 'start' },
      requesting,
      { type: 'text', text: '一半' },
      { type: 'stopped' },
      { type: 'text', text: '迟到' },
      { type: 'finished', usage: null },
    ]);
    expect(state).toMatchObject({ phase: 'stopped', text: '一半' });
  });

  it('keeps the text when the model fails mid-answer', () => {
    const state = play([
      { type: 'start' },
      requesting,
      { type: 'text', text: '部分' },
      { type: 'failed', problem: { kind: 'llm', error: { kind: 'stream', detail: 'boom' } } },
    ]);
    expect(state).toMatchObject({ phase: 'error', text: '部分', problem: { kind: 'llm' } });
  });

  it('starts over cleanly on a retry', () => {
    const failed = play([{ type: 'start' }, { type: 'failed', problem: { kind: 'no-model' } }]);
    expect(play([{ type: 'start' }], failed)).toEqual({
      ...INITIAL_PANEL_STATE,
      phase: 'extracting',
    });
  });

  it('knows when a request is in flight', () => {
    expect(isBusy(play([{ type: 'start' }]))).toBe(true);
    expect(isBusy(play([{ type: 'start' }, requesting, { type: 'stopped' }]))).toBe(false);
    expect(isBusy(INITIAL_PANEL_STATE)).toBe(false);
  });
});
