import { describe, expect, it } from 'vitest';
import { CITATION, checkCitations, findQuote, plainCitations, quotesOf } from '@/domain/citation';

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

  it('maps a match back past empty and whitespace-only chunks', () => {
    const chunks = ['前言', '', '  \n', '它在页面里', '', '打开面板', ' ', '后记'];
    expect(findQuote(chunks, '页面里打开')).toEqual([
      { start: { chunk: 3, offset: 2 }, end: { chunk: 5, offset: 2 } },
    ]);
    expect(covered(chunks, '后记')).toEqual(['后记']);
    expect(covered(chunks, '前言')).toEqual(['前言']);
  });

  it('maps a character that normalizes to several back to the whole of it', () => {
    // NFKC writes ㍿ (one character) as 株式会社.
    expect(covered(['甲㍿乙'], '式会')).toEqual(['㍿']);
    expect(covered(['甲㍿乙'], '社乙')).toEqual(['㍿乙']);
  });

  it('maps every match in one long chunk, overlapping ones too', () => {
    expect(findQuote(['甲甲甲甲'], '甲甲甲')).toEqual([
      { start: { chunk: 0, offset: 0 }, end: { chunk: 0, offset: 3 } },
      { start: { chunk: 0, offset: 1 }, end: { chunk: 0, offset: 4 } },
    ]);
    expect(covered(['A b c, a B c.', '乙 abc'], 'abc')).toEqual(['A b c', 'a B c', 'abc']);
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
    expect(plainCitations('Point [[ a quote ]].', 'en')).toBe('Point “a quote”.');
  });
});

describe('quotesOf', () => {
  it('lists each quote once, trimmed, in order', () => {
    expect(quotesOf('甲 [[ 第一句 ]] 乙 [[第二句]] 丙 [[第一句]]')).toEqual(['第一句', '第二句']);
  });

  it('skips blank quotes and passages that span lines', () => {
    expect(quotesOf('[[   ]] [[跨\n行]] 没有引用')).toEqual([]);
  });
});

describe('checkCitations', () => {
  const page = '一瞥在页面里打开一个浮动面板。The answer streams in as it is written.';

  it('marks each quote as found in the text or not, and counts them', () => {
    expect(
      checkCitations(
        '要点 [[打开一个 浮动面板]]，编造 [[页面上没有这句]]，又 [[打开一个浮动面板]]',
        page,
      ),
    ).toEqual({
      found: { '打开一个 浮动面板': true, 页面上没有这句: false, 打开一个浮动面板: true },
      total: 3,
      matched: 2,
    });
  });

  it('counts a quote made twice twice, as the panel numbers it', () => {
    expect(checkCitations('[[浮动面板]] 又 [[ 浮动面板 ]] 和 [[没有的]]', page)).toMatchObject({
      total: 3,
      matched: 2,
    });
  });

  it('takes any text as a quote, __proto__ included', () => {
    const check = checkCitations('[[__proto__]] [[constructor]]', '__proto__');
    expect(check?.found['__proto__']).toBe(true);
    expect(Object.hasOwn(check?.found ?? {}, 'constructor')).toBe(true);
    expect(check?.found['constructor']).toBe(false);
  });

  it('forgives what copying changes, as findQuote does', () => {
    expect(checkCitations('[[the ANSWER streams … as it is written]]', page)).toMatchObject({
      total: 1,
      matched: 1,
    });
  });

  it('is null for an answer without quotes', () => {
    expect(checkCitations('没有引用的回答', page)).toBeNull();
  });

  it('finds nothing in an empty text', () => {
    expect(checkCitations('[[浮动面板]]', '')).toEqual({
      found: { 浮动面板: false },
      total: 1,
      matched: 0,
    });
  });
});
