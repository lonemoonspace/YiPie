import { describe, expect, it } from 'vitest';
import type { PageContext } from '@/contract/page-context';
import { builtinPrompt } from '@/domain/prompt/default-prompt';
import { TRUNCATION_NOTE, buildPromptMessages, promptValues } from '@/domain/prompt/messages';

const page: PageContext = {
  title: '标题',
  url: 'https://example.com/a',
  lang: 'zh-CN',
  text: '正文第一段。\n\n正文第二段。',
  truncated: false,
};

describe('promptValues', () => {
  it('takes the variables from the page and the answer language', () => {
    expect(promptValues(page, '简体中文')).toEqual({
      title: '标题',
      url: 'https://example.com/a',
      content: page.text,
      selection: '',
      language: '简体中文',
    });
  });

  it('ends the content with a note when the text was cut', () => {
    expect(promptValues({ ...page, truncated: true }, '简体中文').content).toBe(
      `${page.text}\n\n${TRUNCATION_NOTE}`,
    );
  });
});

describe('buildPromptMessages', () => {
  it('sends the built-in instructions as the system message and the page as data', () => {
    const [system, user] = buildPromptMessages(builtinPrompt(), promptValues(page, '简体中文'));

    expect(system?.role).toBe('system');
    expect(system?.content).toContain('请用简体中文写一份结构清晰的 Markdown 总结');
    expect(user).toEqual({
      role: 'user',
      content: [
        '<page>',
        '标题：标题',
        '地址：https://example.com/a',
        '正文：',
        page.text,
        '</page>',
      ].join('\n'),
    });
  });

  it('sends no system message when that template renders blank', () => {
    const messages = buildPromptMessages(
      { system: ' {{selection}} \n', user: '总结：{{content}}' },
      promptValues(page, '简体中文'),
    );
    expect(messages).toEqual([{ role: 'user', content: `总结：${page.text}` }]);
  });
});
