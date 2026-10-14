import { describe, expect, it } from 'vitest';
import {
  EMPTY_PROMPT_FORM,
  formFromPrompt,
  parsePromptForm,
  promptWarnings,
} from '@/domain/prompt-form';

describe('parsePromptForm', () => {
  it('trims the name and keeps the templates exactly as typed', () => {
    expect(
      parsePromptForm({ name: '  要点 ', system: ' 简洁 \n', user: '  {{content}}\n' }),
    ).toEqual({ ok: true, value: { name: '要点', system: ' 简洁 \n', user: '  {{content}}\n' } });
  });

  it('asks for a name and a user template, next to each field', () => {
    expect(parsePromptForm({ ...EMPTY_PROMPT_FORM, user: ' \n' })).toEqual({
      ok: false,
      errors: { name: '请填写名称', user: '请填写 User 模板' },
    });
  });

  it('round-trips a stored prompt', () => {
    const prompt = { name: '要点', system: '', user: '{{content}}' };
    expect(parsePromptForm(formFromPrompt(prompt))).toEqual({ ok: true, value: prompt });
  });
});

describe('promptWarnings', () => {
  it('lists unknown variables from both templates, once each', () => {
    expect(
      promptWarnings({ system: '作者 {{author}}', user: '{{content}} {{author}} {{date}}' }),
    ).toEqual({ unknown: ['author', 'date'], noContent: false });
  });

  it('says when neither template passes the page text', () => {
    expect(promptWarnings({ system: '', user: '标题：{{title}}' }).noContent).toBe(true);
    expect(promptWarnings({ system: '{{content}}', user: '总结' }).noContent).toBe(false);
    expect(promptWarnings({ system: '', user: '{{selection}}' }).noContent).toBe(false);
  });
});
