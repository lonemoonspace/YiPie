import { describe, expect, it } from 'vitest';
import { estimateTokens } from '@/domain/token-estimate';

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
