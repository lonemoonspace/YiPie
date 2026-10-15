import { describe, expect, it } from 'vitest';
import { buildModelsRequest, isModelListUnsupported, parseModelList } from '@/domain/llm/models';

describe('buildModelsRequest', () => {
  it('asks {baseURL}/models with the key and the extra headers', () => {
    expect(
      buildModelsRequest({
        baseURL: 'https://api.example.com/v1/?key=q',
        apiKey: 'sk-1',
        headers: { 'X-Team': 't' },
      }),
    ).toEqual({
      url: 'https://api.example.com/v1/models?key=q',
      headers: { Accept: 'application/json', Authorization: 'Bearer sk-1', 'X-Team': 't' },
    });
  });

  it('sends no Authorization without a key', () => {
    const { headers } = buildModelsRequest({
      baseURL: 'http://localhost:11434/v1',
      apiKey: '',
      headers: {},
    });
    expect(headers).toEqual({ Accept: 'application/json' });
  });
});

describe('parseModelList', () => {
  it("reads OpenAI's shape and a bare array", () => {
    expect(parseModelList('{"object":"list","data":[{"id":"gpt-4o"},{"id":"o3"}]}')).toEqual([
      'gpt-4o',
      'o3',
    ]);
    expect(parseModelList('[{"id":"a"},"b",{"name":"no id"}]')).toEqual(['a', 'b']);
  });

  it('says when the body is no list', () => {
    expect(parseModelList('<html>not found</html>')).toBeNull();
    expect(parseModelList('{"error":"nope"}')).toBeNull();
  });
});

describe('isModelListUnsupported', () => {
  it('takes not found and not allowed for a missing list, not a refused key', () => {
    expect([404, 405, 501].every(isModelListUnsupported)).toBe(true);
    expect([400, 401, 403, 500].some(isModelListUnsupported)).toBe(false);
  });
});
