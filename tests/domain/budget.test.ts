import { describe, expect, it } from 'vitest';
import type { TrimmingStrategy } from '@/contract/general-settings';
import {
  DEFAULT_CONTEXT_WINDOW,
  estimateMessages,
  outputReserve,
  planContent,
  trimText,
  type ContentBudget,
  type CutStrategy,
} from '@/domain/budget';
import { LATE_START_NOTE, OMISSION_NOTE, TRUNCATION_NOTE } from '@/domain/prompt/messages';
import { estimateTokens } from '@/domain/token-estimate';

/** Numbered paragraphs, so a test can tell which part was kept. About 13,000 tokens. */
const PAGE = Array.from({ length: 500 }, (_, i) => `段落${i}：${'字'.repeat(20)}`).join('\n');

const WINDOW = 4_096;
/** What a request may take in a 4,096-token window: 3,072 tokens. */
const LIMIT = WINDOW - outputReserve(WINDOW);

/** A request whose everything-but-the-page costs `overhead`, carrying the page once. */
function budget(
  strategy: TrimmingStrategy,
  overhead: number,
  extra: Partial<ContentBudget> = {},
): ContentBudget {
  return {
    content: PAGE,
    strategy,
    contextWindow: WINDOW,
    measure: (content) => overhead + estimateTokens(content),
    occurrences: 1,
    ...extra,
  };
}

describe('outputReserve', () => {
  it('keeps a quarter of the window for the answer, between 1,024 and 8,192 tokens', () => {
    expect(outputReserve(2_000)).toBe(1_024);
    expect(outputReserve(4_096)).toBe(1_024);
    expect(outputReserve(20_000)).toBe(5_000);
    expect(outputReserve(DEFAULT_CONTEXT_WINDOW)).toBe(8_192);
    expect(outputReserve(1_000_000)).toBe(8_192);
  });
});

describe('estimateMessages', () => {
  it('adds a little for every message and for the reply', () => {
    expect(estimateMessages([])).toBe(3);
    expect(estimateMessages([{ content: 'abc' }, { content: '你好' }])).toBe(3 + (1 + 4) + (2 + 4));
  });
});

describe('planContent: four strategies × fits / does not fit / the prompt does not fit', () => {
  const pageTokens = estimateTokens(PAGE);

  describe.each<CutStrategy>(['back', 'middle', 'front'])('%s', (strategy) => {
    it('sends the page as it is when everything fits, up to the last token', () => {
      expect(planContent(budget(strategy, LIMIT - pageTokens))).toEqual({
        kind: 'fits',
        content: PAGE,
      });
    });

    it('cuts the page to what fits, one token past the limit', () => {
      const plan = planContent(budget(strategy, LIMIT - pageTokens + 1));

      expect(plan.kind).toBe('trimmed');
      if (plan.kind !== 'trimmed') return;
      expect(plan.strategy).toBe(strategy);
      expect(LIMIT - pageTokens + 1 + estimateTokens(plan.content)).toBeLessThanOrEqual(LIMIT);
      expect(plan.totalTokens).toBe(pageTokens);
    });

    it('cuts a page far over the budget down to the budget, no further', () => {
      const plan = planContent(budget(strategy, 100));

      expect(plan).toMatchObject({
        kind: 'trimmed',
        totalTokens: pageTokens,
        contextWindow: WINDOW,
        assumedWindow: false,
      });
      if (plan.kind !== 'trimmed') return;
      const sent = 100 + estimateTokens(plan.content);
      expect(sent).toBeLessThanOrEqual(LIMIT);
      // The whole room is used, give or take the rounding at a cut.
      expect(sent).toBeGreaterThan(LIMIT - 5);
      expect(plan.keptTokens).toBeLessThan(LIMIT - 100);
      expect(plan.keptTokens).toBeGreaterThan(LIMIT - 100 - 60);
    });

    it('sends nothing when the prompt and the conversation alone leave no room', () => {
      expect(planContent(budget(strategy, LIMIT))).toEqual({
        kind: 'too-long',
        requiredTokens: LIMIT + outputReserve(WINDOW),
        contextWindow: WINDOW,
        assumedWindow: false,
      });
      expect(planContent(budget(strategy, LIMIT + 500)).kind).toBe('too-long');
    });
  });

  describe('nothing', () => {
    it('sends the page as it is when it fits', () => {
      expect(planContent(budget('nothing', 0))).toEqual({ kind: 'unchecked', content: PAGE });
    });

    it('sends the page as it is when it does not fit: the user chose so', () => {
      expect(planContent(budget('nothing', 100))).toEqual({ kind: 'unchecked', content: PAGE });
    });

    it('sends the page as it is even when the prompt alone does not fit', () => {
      expect(planContent(budget('nothing', LIMIT + 500))).toEqual({
        kind: 'unchecked',
        content: PAGE,
      });
    });
  });
});

describe('planContent: which part is kept', () => {
  const kept = (strategy: CutStrategy) => {
    const plan = planContent(budget(strategy, 100));
    if (plan.kind !== 'trimmed') throw new Error(`expected a cut, got ${plan.kind}`);
    return plan.content;
  };

  it('back keeps the start and says the rest was cut', () => {
    const content = kept('back');
    expect(content.startsWith('段落0：')).toBe(true);
    expect(content.endsWith(`\n\n${TRUNCATION_NOTE}`)).toBe(true);
    expect(content).not.toContain('段落499：');
  });

  it('front keeps the end and says the start was cut', () => {
    const content = kept('front');
    expect(content.startsWith(`${LATE_START_NOTE}\n\n`)).toBe(true);
    expect(content.endsWith(`段落499：${'字'.repeat(20)}`)).toBe(true);
    expect(content).not.toContain('段落0：');
  });

  it('middle keeps both ends, about half each, and marks the gap', () => {
    const content = kept('middle');
    const [head = '', tail = ''] = content.split(`\n\n${OMISSION_NOTE}\n\n`);
    expect(head.startsWith('段落0：')).toBe(true);
    expect(tail.endsWith(`段落499：${'字'.repeat(20)}`)).toBe(true);
    expect(content).not.toContain('段落250：');
    expect(Math.abs(estimateTokens(head) - estimateTokens(tail))).toBeLessThanOrEqual(2);
  });
});

describe('planContent: details', () => {
  it('assumes the default window when the configuration leaves it blank', () => {
    const plan = planContent({ ...budget('back', 100), contextWindow: null });

    // 13,000 tokens fit in 64,000 less the answer's room.
    expect(plan.kind).toBe('fits');
    const long = PAGE.repeat(5);
    expect(
      planContent({ ...budget('back', 100), content: long, contextWindow: null }),
    ).toMatchObject({
      kind: 'trimmed',
      contextWindow: DEFAULT_CONTEXT_WINDOW,
      assumedWindow: true,
    });
  });

  it('shares the room between the places the page appears', () => {
    const plan = planContent(
      budget('back', 100, {
        measure: (content) => 100 + 2 * estimateTokens(content),
        occurrences: 2,
      }),
    );

    expect(plan.kind).toBe('trimmed');
    if (plan.kind !== 'trimmed') return;
    expect(100 + 2 * estimateTokens(plan.content)).toBeLessThanOrEqual(LIMIT);
    expect(100 + 2 * estimateTokens(plan.content)).toBeGreaterThan(LIMIT - 10);
  });

  it('keeps shrinking when the whole request costs more than its parts', () => {
    // As when the system template is nothing but {{content}}: the message,
    // and what it costs, exists only once there is content.
    const measure = (content: string) =>
      100 + estimateTokens(content) + (content === '' ? 0 : 4 + 4);
    const plan = planContent(budget('back', 100, { measure }));

    expect(plan.kind).toBe('trimmed');
    if (plan.kind !== 'trimmed') return;
    expect(measure(plan.content)).toBeLessThanOrEqual(LIMIT);
  });

  it('cannot make room when the request does not carry the page at all', () => {
    const measure = () => LIMIT + 1;

    expect(planContent(budget('back', 0, { measure, occurrences: 0 })).kind).toBe('too-long');
    expect(planContent(budget('back', 0, { measure: () => LIMIT, occurrences: 0 })).kind).toBe(
      'fits',
    );
  });

  it('gives up when the room left cannot hold the note beside a single character', () => {
    const note = estimateTokens(`\n\n${TRUNCATION_NOTE}`);
    const content = 'x'.repeat(10_000);

    expect(planContent(budget('back', LIMIT - note - 1, { content })).kind).toBe('trimmed');
    expect(planContent(budget('back', LIMIT - note, { content })).kind).toBe('too-long');
  });
});

describe('trimText', () => {
  it('leaves text that fits alone, without a note', () => {
    expect(trimText('短文', 'back', 10)).toEqual({ text: '短文', keptTokens: 2, cut: false });
  });

  it('never splits a character', () => {
    const emoji = '😀'.repeat(100);
    for (const strategy of ['back', 'middle', 'front'] as const) {
      const trimmed = trimText(emoji, strategy, 60);
      expect(trimmed?.cut).toBe(true);
      expect(trimmed?.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
      expect(trimmed?.text).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
      expect(estimateTokens(trimmed?.text ?? '')).toBeLessThanOrEqual(60);
    }
  });

  it('reports the tokens of the page text kept, notes left out', () => {
    const trimmed = trimText('a'.repeat(3_000), 'back', 100);
    const kept = trimmed?.text.replace(`\n\n${TRUNCATION_NOTE}`, '') ?? '';

    expect(trimmed?.keptTokens).toBe(estimateTokens(kept));
    expect(estimateTokens(trimmed?.text ?? '')).toBeLessThanOrEqual(100);
  });

  it('returns null when there is no room beside the note', () => {
    expect(trimText('a'.repeat(3_000), 'back', 5)).toBeNull();
    expect(trimText('a'.repeat(3_000), 'front', 5)).toBeNull();
    expect(trimText('a'.repeat(3_000), 'middle', 5)).toBeNull();
  });
});
