import { describe, expect, it } from 'vitest';
import { CITATION, findQuote, plainCitations } from '@/domain/citation';

/** The text a match covers, read back from the chunks. */
function covered(chunks: string[], quote: string): string[] {
  return findQuote(chunks, quote).map(({ start, end }) => {
    let text = '';
    for (let chunk = start.chunk; chunk <= end.chunk; chunk += 1) {
      const value = chunks[chunk] ?? '';
      text += value.slice(
        chunk === start.chunk ? start.offset : 0,
        chunk === end.chunk ? end.offset : value.length,
      );
    }
    return text;
  });
}

describe('findQuote', () => {
  it('finds a passage, and every place it occurs', () => {
    expect(covered(['甲乙丙。甲乙丙。'], '乙丙')).toEqual(['乙丙', '乙丙']);
  });

  it('finds nothing when the page does not say it', () => {
    expect(findQuote(['一瞥是一个浏览器扩展。'], '一瞥是一个网站')).toEqual([]);
    expect(findQuote(['正文'], '   ')).toEqual([]);
  });

  it('matches across element boundaries', () => {
    const chunks = ['它在页面里打开', '一个', '浮动面板，把正文交给模型。'];
    expect(findQuote(chunks, '打开一个浮动面板')).toEqual([
      { start: { chunk: 0, offset: 5 }, end: { chunk: 2, offset: 4 } },
    ]);
  });

  it('forgives differences in whitespace, case and full-width forms', () => {
    expect(covered(['The panel  runs\nin an extension frame.'], 'the panel runs in an')).toEqual([
      'The panel  runs\nin an',
    ]);
    expect(covered(['版本 ２．０ 已发布'], '版本2.0已发布')).toEqual(['版本 ２．０ 已发布']);
    expect(covered(['A B'], 'a b')).toEqual(['A B']);
  });

  it('spans a passage whose middle the model left out, from the first part to the last', () => {
    const chunks = ['一瞥把当前网页交给模型服务，在浮动面板里给出总结。下一段。'];
    expect(covered(chunks, '一瞥把当前网页……给出总结')).toEqual([
      '一瞥把当前网页交给模型服务，在浮动面板里给出总结',
    ]);
    expect(findQuote(chunks, '给出总结……一瞥把当前网页')).toEqual([]);
  });

  it('keeps offsets right around characters outside the BMP', () => {
    expect(covered(['😀一瞥😀'], '一瞥')).toEqual(['一瞥']);
  });
});

describe('citations in model output', () => {
  it('recognizes [[passage]] on one line', () => {
    expect(CITATION.exec('见 [[原文片段]]。')?.[1]).toBe('原文片段');
    expect(CITATION.exec('[[跨\n行]]')).toBeNull();
    expect(CITATION.exec('[[]]')).toBeNull();
  });

  it('writes quotes as plain text for copying', () => {
    expect(plainCitations('要点 [[ 原文 ]]，另见 [[第二处]]')).toBe(
      '要点 「原文」，另见 「第二处」',
    );
  });
});
