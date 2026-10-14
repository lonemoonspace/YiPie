import { describe, expect, it } from 'vitest';
import { ModelConfig } from '@/contract/model-config';
import {
  EMPTY_MODEL_FORM,
  formFromConfig,
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
