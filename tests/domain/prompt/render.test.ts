import { describe, expect, it } from 'vitest';
import { renderTemplate, templateVariables, type PromptValues } from '@/domain/prompt/render';

const values: PromptValues = {
  title: '标题',
  url: 'https://example.com/?a=1&b=2',
  content: '正文',
  selection: '选中的文字',
  language: 'zh-CN',
};

describe('renderTemplate', () => {
  it('fills every variable, with or without spaces inside the braces', () => {
    expect(
      renderTemplate('{{title}} {{ url }} {{content}} {{selection}} {{language}}', values),
    ).toEqual({
      text: '标题 https://example.com/?a=1&b=2 正文 选中的文字 zh-CN',
      unknown: [],
    });
  });

  it('keeps unknown placeholders as written, and lists each once', () => {
    expect(
      renderTemplate('{{author}} wrote {{ title }} for {{author}} and {{date }}', values),
    ).toEqual({
      text: '{{author}} wrote 标题 for {{author}} and {{date }}',
      unknown: ['author', 'date'],
    });
  });

  it('does not parse a value again: a page that contains placeholders stays literal', () => {
    const tricky = { ...values, content: '{{title}} {{url}} $& $1 {{apiKey}}' };
    expect(renderTemplate('[{{content}}]', tricky)).toEqual({
      text: '[{{title}} {{url}} $& $1 {{apiKey}}]',
      unknown: [],
    });
  });

  it('escapes nothing: this is text for a model, not HTML', () => {
    const html = { ...values, title: '<b>"A & B"</b>' };
    expect(renderTemplate('{{title}}', html).text).toBe('<b>"A & B"</b>');
  });

  it('reaches nothing but the page values', () => {
    for (const name of ['constructor', 'toString', '__proto__', 'apiKey', 'config']) {
      expect(renderTemplate(`{{${name}}}`, values)).toEqual({
        text: `{{${name}}}`,
        unknown: [name],
      });
    }
  });

  it('leaves text that only looks like a placeholder alone', () => {
    const template = '{title} {{ }} {{1abc}} {{a-b}} {{title';
    expect(renderTemplate(template, values)).toEqual({ text: template, unknown: [] });
  });
});

describe('templateVariables', () => {
  it('lists the variables a template uses and the unknown ones', () => {
    expect(templateVariables('{{content}} {{titel}} {{content}} {{url}}')).toEqual({
      used: ['content', 'url'],
      unknown: ['titel'],
    });
  });
});
