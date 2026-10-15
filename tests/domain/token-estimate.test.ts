import { describe, expect, it } from 'vitest';
import { estimateTokens, fitTokens } from '@/domain/token-estimate';

describe('estimateTokens', () => {
  it('is zero for empty text', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('charges ASCII at one token per three characters, rounded up', () => {
    expect(estimateTokens('hello world')).toBe(4); // 11 / 3
    expect(estimateTokens('abc')).toBe(1);
  });

  it('charges CJK text one token per character', () => {
    expect(estimateTokens('你好，世界')).toBe(5); // the full-width comma counts as CJK
    expect(estimateTokens('こんにちは')).toBe(5);
  });

  it('charges two-byte scripts half a token per character', () => {
    expect(estimateTokens('Привет')).toBe(3);
  });

  it('adds the ASCII and non-ASCII parts', () => {
    expect(estimateTokens('AI 总结')).toBe(3); // ceil(3 / 3) + 2
  });

  it('counts by code point, not by UTF-16 unit', () => {
    // A single emoji cannot tell the two apart once rounding kicks in, so use
    // a hundred: 100 code points at 3/2 is 150; 200 UTF-16 units would be 300.
    const emoji = '😀'.repeat(100);
    expect(emoji.length).toBe(200);
    expect(estimateTokens(emoji)).toBe(150);
  });

  it('never decreases when text is appended', () => {
    const samples = ['', 'a', 'abc', '你', 'Привет', '😀', 'mixed 文本 😀 текст'];
    for (const head of samples) {
      for (const tail of samples) {
        expect(estimateTokens(head + tail)).toBeGreaterThanOrEqual(estimateTokens(head));
      }
    }
  });
});

describe('fitTokens', () => {
  const samples = ['', 'abcdefg', '你好世界', 'mixed 文本 😀 текст and more', '😀'.repeat(7)];

  it('keeps as much as fits, from either end, and not one code point more', () => {
    for (const text of samples) {
      const codePoints = Array.from(text);
      for (let limit = 0; limit <= estimateTokens(text) + 1; limit++) {
        const head = fitTokens(codePoints, limit, 'start');
        const tail = fitTokens(codePoints, limit, 'end');

        expect(estimateTokens(codePoints.slice(0, head).join(''))).toBeLessThanOrEqual(limit);
        expect(
          estimateTokens(codePoints.slice(codePoints.length - tail).join('')),
        ).toBeLessThanOrEqual(limit);
        if (head < codePoints.length) {
          expect(estimateTokens(codePoints.slice(0, head + 1).join(''))).toBeGreaterThan(limit);
        }
        if (tail < codePoints.length) {
          expect(
            estimateTokens(codePoints.slice(codePoints.length - tail - 1).join('')),
          ).toBeGreaterThan(limit);
        }
      }
    }
  });

  it('counts whole code points, so a cut never falls inside a character', () => {
    expect(fitTokens(Array.from('😀😀😀'), 2, 'start')).toBe(1);
    expect(fitTokens(Array.from('ab😀'), 1, 'end')).toBe(0);
    expect(fitTokens(Array.from('ab😀'), 3, 'end')).toBe(3);
  });
});
