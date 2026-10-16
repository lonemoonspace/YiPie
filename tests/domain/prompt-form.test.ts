import { describe, expect, it } from 'vitest';
import {
  SUMMARY_SYSTEM_TEMPLATE,
  SUMMARY_USER_TEMPLATE,
  builtinPrompts,
} from '@/domain/prompt/default-prompt';
import {
  formFromPrompt,
  distinctiveLine,
  newPromptForm,
  parsePromptForm,
  presetForms,
  previewPrompt,
  promptFormWarnings,
  unknownVariableFlags,
  variableHints,
} from '@/domain/prompt-form';

describe('parsePromptForm', () => {
  it('trims the name and keeps the templates exactly as typed', () => {
    expect(parsePromptForm({ name: ' 要点 ', system: '  ', user: '\n{{content}}\n' })).toEqual({
      ok: true,
      value: { name: '要点', system: '  ', user: '\n{{content}}\n' },
    });
  });

  it('asks for a name and a user template', () => {
    expect(parsePromptForm({ name: ' ', system: 'x', user: ' \n' })).toEqual({
      ok: false,
      errors: { name: '请填写名称', user: '用户模板不能为空' },
    });
  });
});

describe('promptFormWarnings', () => {
  it('has nothing to say about the built-in templates', () => {
    expect(promptFormWarnings(newPromptForm())).toEqual({});
    expect(unknownVariableFlags(newPromptForm())).toEqual({});
  });

  it('flags unknown placeholders in each template', () => {
    expect(
      unknownVariableFlags({
        name: 'n',
        system: '{{ lang }}',
        user: '{{content}} {{foo}} {{bar}}',
      }),
    ).toEqual({
      system: ['未知变量 {{ lang }} 会原样发送给模型。'],
      user: ['未知变量 {{foo}}、{{bar}} 会原样发送给模型。'],
    });
  });

  it('warns when neither template sends the page', () => {
    expect(promptFormWarnings({ name: 'n', system: '', user: '总结 {{title}}' })).toEqual({
      user: ['两个模板里都没有 {{content}}：页面正文不会发送给模型。'],
    });
    expect(promptFormWarnings({ name: 'n', system: '{{content}}', user: 'x' })).toEqual({});
  });
});

describe('the editor hints', () => {
  it('lists every variable with its meaning', () => {
    expect(variableHints().map((hint) => hint.placeholder)).toEqual([
      '{{title}}',
      '{{url}}',
      '{{content}}',
      '{{selection}}',
      '{{language}}',
    ]);
    expect(variableHints().every((hint) => hint.meaning !== '')).toBe(true);
  });

  it('previews the templates for a sample page, leaving unknown placeholders as written', () => {
    expect(
      previewPrompt({
        name: 'n',
        system: '用{{language}}',
        user: '{{title}}\n{{content}} {{foo}}',
      }),
    ).toEqual({
      system: '用简体中文',
      user: '示例：一瞥的设计笔记\n（这里是网页正文） {{foo}}',
    });
  });
});

describe('the form for a new prompt', () => {
  it('starts from the built-in templates, without a name', () => {
    expect(newPromptForm()).toEqual({
      name: '',
      system: SUMMARY_SYSTEM_TEMPLATE,
      user: SUMMARY_USER_TEMPLATE,
    });
  });

  it('can start from any built-in prompt, its name included, without an id', () => {
    expect(presetForms()).toEqual(
      builtinPrompts('zh-Hans').map(({ name, system, user }) => ({ name, system, user })),
    );
    for (const preset of presetForms()) {
      expect(parsePromptForm(preset).ok).toBe(true);
      expect(promptFormWarnings(preset)).toEqual({});
    }
  });

  it('shows a stored prompt as it is', () => {
    expect(formFromPrompt({ id: 'p', name: '要点', system: 's', user: 'u' })).toEqual({
      name: '要点',
      system: 's',
      user: 'u',
    });
  });
});

describe('distinctiveLine', () => {
  it('skips the opening the other prompts share, to what this one writes', () => {
    const [summary, quick, notes] = builtinPrompts('zh-Hans');
    if (!summary || !quick || !notes) throw new Error('three presets');
    expect(distinctiveLine(quick, [summary, notes])).toContain('30 秒能读完');
    expect(distinctiveLine(summary, [quick, notes])).toContain('便于快速阅读');
  });

  it('is the first line when the prompt is alone, or nothing is shared', () => {
    expect(distinctiveLine({ system: '\n第一行\n第二行', user: '' }, [])).toBe('第一行');
    expect(distinctiveLine({ system: '', user: '列出要点：{{content}}' }, [])).toBe(
      '列出要点：{{content}}',
    );
    expect(distinctiveLine({ system: '甲\n乙', user: '' }, [{ system: '丙', user: '' }])).toBe(
      '甲',
    );
  });
});
