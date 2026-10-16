import { describe, expect, it } from 'vitest';
import type { PageContext } from '@/contract/page-context';
import { builtinPrompt } from '@/domain/prompt/default-prompt';
import {
  TRUNCATION_NOTE,
  buildPromptMessages,
  conversationMessages,
  pageContent,
  promptValues,
} from '@/domain/prompt/messages';

const page: PageContext = {
  title: '标题',
  url: 'https://example.com/a',
  lang: 'zh-CN',
  text: '正文第一段。\n\n正文第二段。',
  selection: '',
  truncated: false,
};

const values = promptValues(page, page.text, '简体中文');

describe('pageContent', () => {
  it('is the page text', () => {
    expect(pageContent(page)).toBe(page.text);
  });

  it('ends with a note when extraction cut the text', () => {
    expect(pageContent({ ...page, truncated: true })).toBe(`${page.text}\n\n${TRUNCATION_NOTE}`);
  });
});

describe('promptValues', () => {
  it('takes the variables from the page, the content as given and the answer language', () => {
    expect(promptValues(page, '裁剪后的正文', '简体中文')).toEqual({
      title: '标题',
      url: 'https://example.com/a',
      content: '裁剪后的正文',
      selection: '',
      language: '简体中文',
    });
    expect(promptValues({ ...page, selection: '选中的话' }, '正文', '英语').selection).toBe(
      '选中的话',
    );
  });
});

describe('buildPromptMessages', () => {
  it('sends the built-in instructions as the system message and the page as data', () => {
    const [system, user] = buildPromptMessages(builtinPrompt('zh-Hans'), values);

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
      values,
    );
    expect(messages).toEqual([{ role: 'user', content: `总结：${page.text}` }]);
  });
});

describe('conversationMessages', () => {
  const prompt = { system: '系统', user: '正文：{{content}}' };

  it('is the prompt alone for a summary', () => {
    expect(conversationMessages(prompt, values, [], null)).toEqual([
      { role: 'system', content: '系统' },
      { role: 'user', content: `正文：${page.text}` },
    ]);
  });

  it('follows the prompt with the conversation so far, then the new question', () => {
    const history = [
      { role: 'assistant' as const, content: '总结' },
      { role: 'user' as const, content: '第一个问题' },
      { role: 'assistant' as const, content: '第一个回答' },
    ];

    expect(conversationMessages(prompt, values, history, '第二个问题')).toEqual([
      { role: 'system', content: '系统' },
      { role: 'user', content: `正文：${page.text}` },
      { role: 'assistant', content: '总结' },
      { role: 'user', content: '第一个问题' },
      { role: 'assistant', content: '第一个回答' },
      { role: 'user', content: '第二个问题' },
    ]);
  });

  it('sends only the role and the text of a stored message', () => {
    const stored = { role: 'assistant' as const, content: '总结', stopped: false, usage: null };

    expect(conversationMessages(prompt, values, [stored], '问题')[2]).toEqual({
      role: 'assistant',
      content: '总结',
    });
  });
});
