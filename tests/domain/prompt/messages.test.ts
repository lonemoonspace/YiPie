import { describe, expect, it } from 'vitest';
import type { PageContext } from '@/contract/page-context';
import { BUILT_IN_PROMPT, SUMMARY_SYSTEM_PROMPT } from '@/domain/prompt/default-prompt';
import { buildPromptMessages, pageValues, TRUNCATED_NOTE } from '@/domain/prompt/messages';

const page: PageContext = {
  title: '标题',
  url: 'https://example.com/a',
  lang: 'zh-CN',
  text: '正文第一段。\n\n正文第二段。',
  truncated: false,
};

describe('buildPromptMessages', () => {
  it('sends the built-in instructions as the system message and the page as data', () => {
    const [system, user] = buildPromptMessages(BUILT_IN_PROMPT, page);

    expect(system).toEqual({ role: 'system', content: SUMMARY_SYSTEM_PROMPT });
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

  it('sends no system message for a blank system template', () => {
    expect(buildPromptMessages({ system: ' \n', user: '总结：{{content}}' }, page)).toEqual([
      { role: 'user', content: `总结：${page.text}` },
    ]);
  });

  it('fills in the page language', () => {
    const [user] = buildPromptMessages({ system: '', user: '语言：{{language}}' }, page);
    expect(user?.content).toBe('语言：zh-CN');
  });
});

describe('pageValues', () => {
  it('says when the text was cut, after the text', () => {
    expect(pageValues({ ...page, truncated: true }).content).toBe(
      `${page.text}\n\n${TRUNCATED_NOTE}`,
    );
    expect(pageValues(page).content).toBe(page.text);
  });

  it('leaves the selection empty until selection summaries exist', () => {
    expect(pageValues(page).selection).toBe('');
  });
});
