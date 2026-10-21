import { describe, expect, it } from 'vitest';
import { ModelConfig } from '@/contract/model-config';
import {
  EMPTY_MODEL_FORM,
  formFromConfig,
  modelOptions,
  addMenuModel,
  followModelRename,
  parseMenuModels,
  parseConnectionFields,
  parseModelForm,
  type ModelFormFields,
} from '@/domain/model-form';

const filled: ModelFormFields = {
  ...EMPTY_MODEL_FORM,
  name: ' 本地 ',
  baseURL: ' http://localhost:11434/v1/chat/completions ',
  model: ' qwen2.5:7b ',
};

describe('parseModelForm', () => {
  it('tidies a valid form', () => {
    expect(parseModelForm(filled)).toEqual({
      ok: true,
      value: {
        name: '本地',
        baseURL: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'qwen2.5:7b',
        menuModels: [],
        headers: {},
        extraBody: {},
        contextWindow: null,
        streamUsage: true,
      },
    });
  });

  it('parses the JSON fields and the context window', () => {
    const result = parseModelForm({
      ...filled,
      headers: '{"X-Title": "YiPie"}',
      extraBody: '{"temperature": 0.3}',
      contextWindow: ' 32768 ',
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        headers: { 'X-Title': 'YiPie' },
        extraBody: { temperature: 0.3 },
        contextWindow: 32768,
      },
    });
  });

  it('reports every problem next to its field', () => {
    const result = parseModelForm({
      ...EMPTY_MODEL_FORM,
      baseURL: 'localhost:11434',
      headers: '{"X-Count": 3}',
      extraBody: '[1, 2]',
      contextWindow: '8k',
    });
    expect(result).toEqual({
      ok: false,
      errors: {
        baseURL: 'Base URL 必须以 http:// 或 https:// 开头',
        model: '请填写模型名',
        headers: '请求头的值必须是字符串：X-Count',
        extraBody: '额外请求体字段（JSON 对象）不是有效的 JSON 对象',
        contextWindow: '上下文窗口必须是正整数',
      },
    });
  });

  it.each(['0', '-5', '1.5', '99999999999999999999'])('rejects the context window %s', (value) => {
    expect(parseModelForm({ ...filled, contextWindow: value })).toMatchObject({
      ok: false,
      errors: { contextWindow: '上下文窗口必须是正整数' },
    });
  });

  it('rejects a header the browser would not send, naming it', () => {
    expect(parseModelForm({ ...filled, headers: '{"X-API-Key": "k", "Cookie": "a=1"}' })).toEqual({
      ok: false,
      errors: { headers: '浏览器不允许扩展设置这个请求头，它不会被发送：Cookie' },
    });
  });

  it('rejects extra body fields the request sets itself, naming the field', () => {
    expect(
      parseModelForm({ ...filled, extraBody: '{"temperature": 0.2, "stream": false}' }),
    ).toEqual({
      ok: false,
      errors: { extraBody: '请求自己会设置 stream，额外请求体字段不能覆盖它' },
    });
  });

  it('rejects headers that are not JSON', () => {
    expect(parseModelForm({ ...filled, headers: '{oops' })).toMatchObject({
      ok: false,
      errors: { headers: '额外请求头（JSON 对象）不是有效的 JSON 对象' },
    });
  });
});

describe('formFromConfig', () => {
  it('round-trips through the parser', () => {
    const config = ModelConfig.parse({
      id: 'a',
      name: 'DeepSeek',
      baseURL: 'https://api.deepseek.com',
      apiKey: 'sk-x',
      model: 'deepseek-chat',
      menuModels: ['deepseek-chat', 'deepseek-reasoner'],
      headers: { 'X-A': '1' },
      extraBody: { temperature: 0.5 },
      contextWindow: 65536,
      streamUsage: false,
    });

    const parsed = parseModelForm(formFromConfig(config));
    expect(parsed).toEqual({
      ok: true,
      value: {
        name: 'DeepSeek',
        baseURL: 'https://api.deepseek.com',
        apiKey: 'sk-x',
        model: 'deepseek-chat',
        menuModels: ['deepseek-chat', 'deepseek-reasoner'],
        headers: { 'X-A': '1' },
        extraBody: { temperature: 0.5 },
        contextWindow: 65536,
        streamUsage: false,
      },
    });
  });

  it('shows empty JSON fields as empty text', () => {
    const config = ModelConfig.parse({ id: 'a', baseURL: 'http://x.test', model: 'm' });
    expect(formFromConfig(config)).toMatchObject({ headers: '', extraBody: '', contextWindow: '' });
  });
});

describe('parseConnectionFields', () => {
  it('needs no model name, only what reaches the service', () => {
    expect(
      parseConnectionFields({
        ...EMPTY_MODEL_FORM,
        baseURL: ' https://api.example.com/v1/ ',
        apiKey: ' sk-test ',
        headers: '{"X-Org": "a"}',
        extraBody: 'not json',
      }),
    ).toEqual({
      ok: true,
      value: {
        baseURL: 'https://api.example.com/v1',
        apiKey: 'sk-test',
        headers: { 'X-Org': 'a' },
      },
    });
  });

  it('reports a bad address or bad headers next to their fields', () => {
    const result = parseConnectionFields({ ...EMPTY_MODEL_FORM, baseURL: '', headers: '[1]' });
    expect(result.ok).toBe(false);
    expect(Object.keys(result.ok ? {} : result.errors).sort()).toEqual(['baseURL', 'headers']);
  });

  it('refuses headers the browser would not send', () => {
    const result = parseConnectionFields({
      ...EMPTY_MODEL_FORM,
      baseURL: 'https://api.example.com/v1',
      headers: '{"Cookie": "a"}',
    });
    expect(result.ok).toBe(false);
  });
});

describe('modelOptions', () => {
  it('lists each id once, in alphabetical order', () => {
    expect(modelOptions(['gpt-4o', 'deepseek-chat', 'gpt-4o', 'claude'])).toEqual([
      'claude',
      'deepseek-chat',
      'gpt-4o',
    ]);
  });
});

describe('the menu models field', () => {
  it('reads one name per line, trimmed, each once, without blank lines', () => {
    expect(parseMenuModels(' a \n\nb\na\n')).toEqual(['a', 'b']);
  });

  it('adds a name on a new line unless it is there', () => {
    expect(addMenuModel('', 'a')).toBe('a');
    expect(addMenuModel('a\n', 'b')).toBe('a\nb');
    expect(addMenuModel('a\nb', 'a')).toBe('a\nb');
  });

  it('refuses more names than the menu holds', () => {
    const many = Array.from({ length: 51 }, (_, index) => `m${index}`).join('\n');
    const result = parseModelForm({ ...filled, menuModels: many });
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.errors.menuModels).toBeTruthy();
  });
});

describe('followModelRename', () => {
  const saved = (model: string, menuModels: string[]) => {
    const result = parseModelForm({ ...filled, model, menuModels: menuModels.join('\n') });
    if (!result.ok) throw new Error('the form should parse');
    return result.value;
  };

  it('puts the new model name where the old one was on the menu', () => {
    expect(followModelRename('m1', saved('m9', ['m1', 'm2'])).menuModels).toEqual(['m9', 'm2']);
  });

  it('leaves the list alone when it already has the new name, or never had the old one', () => {
    expect(followModelRename('m1', saved('m2', ['m1', 'm2'])).menuModels).toEqual(['m1', 'm2']);
    expect(followModelRename('m1', saved('m9', ['m2', 'm3'])).menuModels).toEqual(['m2', 'm3']);
    expect(followModelRename('m1', saved('m1', ['m1', 'm2'])).menuModels).toEqual(['m1', 'm2']);
  });
});
