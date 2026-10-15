import { describe, expect, it } from 'vitest';
import {
  PROMPT_VARIABLES,
  countVariable,
  renderTemplate,
  unknownPlaceholders,
  usesVariable,
  type PromptValues,
} from '@/domain/prompt/render';

const values: PromptValues = {
  title: '标题',
  url: 'https://example.com/a?b=1',
  content: '正文',
  selection: '',
  language: '简体中文',
};

describe('renderTemplate', () => {
  it('fills every variable', () => {
    expect(renderTemplate('{{title}}|{{url}}|{{content}}|{{selection}}|{{language}}', values)).toBe(
      '标题|https://example.com/a?b=1|正文||简体中文',
    );
  });

  it('accepts spaces inside the braces', () => {
    expect(renderTemplate('{{ title }} / {{title  }}', values)).toBe('标题 / 标题');
  });

  it('keeps unknown placeholders exactly as written', () => {
    const template = '{{foo}} {{ bar }} {{}} {{foo-bar}} {{Title}}';
    expect(renderTemplate(template, values)).toBe(template);
  });

  it('does not read a value again: a page cannot pull in other variables', () => {
    const page = { ...values, title: '{{content}} and {{url}}', content: 'SECRET?' };
    expect(renderTemplate('{{title}}', page)).toBe('{{content}} and {{url}}');
  });

  it('inserts values verbatim: no escaping, no replacement patterns', () => {
    const tricky = `<b>&amp;</b> "q" 'a' $& $1 $$ \\n`;
    expect(renderTemplate('[{{content}}]', { ...values, content: tricky })).toBe(`[${tricky}]`);
  });

  it('treats inherited property names as unknown, not as variables', () => {
    const template = '{{constructor}} {{__proto__}} {{toString}} {{hasOwnProperty}}';
    expect(renderTemplate(template, values)).toBe(template);
  });

  it('only knows the five variables, none of which can name a configuration', () => {
    expect(PROMPT_VARIABLES).toEqual(['title', 'url', 'content', 'selection', 'language']);
    expect(renderTemplate('{{apiKey}} {{baseURL}} {{model}}', values)).toBe(
      '{{apiKey}} {{baseURL}} {{model}}',
    );
  });

  it('leaves the brace that is not part of a placeholder', () => {
    expect(renderTemplate('{{{title}}}', values)).toBe('{标题}');
  });
});

describe('unknownPlaceholders', () => {
  it('lists each unknown placeholder once, as written, in order', () => {
    expect(unknownPlaceholders('{{ foo }} {{title}} {{bar}} {{ foo }} {{constructor}}')).toEqual([
      '{{ foo }}',
      '{{bar}}',
      '{{constructor}}',
    ]);
  });

  it('finds nothing in a template that only uses variables', () => {
    expect(unknownPlaceholders('{{title}}\n{{ content }}')).toEqual([]);
  });
});

describe('usesVariable', () => {
  it('sees a variable however it is spaced', () => {
    expect(usesVariable('x {{ content }} y', 'content')).toBe(true);
    expect(usesVariable('{{contents}}', 'content')).toBe(false);
  });
});

describe('countVariable', () => {
  it('counts every use, since each one inserts the value again', () => {
    expect(countVariable('{{content}} and {{ content }}, not {{contents}}', 'content')).toBe(2);
    expect(countVariable('{{title}}', 'content')).toBe(0);
  });
});
