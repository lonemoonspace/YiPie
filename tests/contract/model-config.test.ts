import { describe, expect, it } from 'vitest';
import {
  ModelConfig,
  ModelConfigDraft,
  ModelConfigPatch,
  displayName,
  menuModelNames,
  isForbiddenHeaderName,
} from '@/contract/model-config';

describe('ModelConfig', () => {
  it('fills defaults for fields a stored value lacks', () => {
    expect(
      ModelConfig.parse({ id: 'a', baseURL: 'http://localhost:11434/v1', model: 'm' }),
    ).toEqual({
      id: 'a',
      name: '',
      baseURL: 'http://localhost:11434/v1',
      apiKey: '',
      model: 'm',
      menuModels: [],
      headers: {},
      extraBody: {},
      contextWindow: null,
      streamUsage: true,
    });
  });

  it('keeps fields it does not know', () => {
    const parsed = ModelConfig.parse({ id: 'a', baseURL: 'http://x.test', model: 'm', future: 1 });
    expect(parsed).toHaveProperty('future', 1);
  });

  it.each([
    ['a non-http base URL', { baseURL: 'file:///etc/passwd' }],
    ['a header that is not a string', { headers: { 'X-A': 1 } }],
    ['an empty model', { model: '' }],
    ['a zero context window', { contextWindow: 0 }],
  ])('rejects %s', (_label, override) => {
    expect(
      ModelConfig.safeParse({ id: 'a', baseURL: 'http://x.test', model: 'm', ...override }).success,
    ).toBe(false);
  });
});

describe('ModelConfigDraft', () => {
  it('refuses fields it does not define, such as an id', () => {
    expect(
      ModelConfigDraft.safeParse({ id: 'x', baseURL: 'http://x.test', model: 'm' }).success,
    ).toBe(false);
  });
});

describe('ModelConfigPatch', () => {
  it('carries no defaults: an empty patch names no fields', () => {
    expect(ModelConfigPatch.parse({})).toEqual({});
  });
});

describe('headers the browser will not send', () => {
  it.each(['Cookie', 'cookie', 'Host', 'Origin', 'Proxy-Authorization', 'Sec-Fetch-Site', 'DNT'])(
    'recognizes %s',
    (name) => {
      expect(isForbiddenHeaderName(name)).toBe(true);
    },
  );

  it.each(['Authorization', 'X-API-Key', 'api-key', 'HTTP-Referer', 'X-Proxy-Token'])(
    'allows %s',
    (name) => {
      expect(isForbiddenHeaderName(name)).toBe(false);
    },
  );

  it('are refused in a draft and in a patch, naming the header', () => {
    const draft = ModelConfigDraft.safeParse({
      baseURL: 'http://x.test',
      model: 'm',
      headers: { 'X-API-Key': 'k', Cookie: 'session=1' },
    });
    expect(draft.success).toBe(false);
    expect(draft.error?.issues).toMatchObject([{ path: ['headers', 'Cookie'] }]);

    expect(ModelConfigPatch.safeParse({ headers: { 'proxy-authorization': 'x' } }).success).toBe(
      false,
    );
    expect(ModelConfigPatch.safeParse({ headers: { 'X-API-Key': 'k' } }).success).toBe(true);
  });

  it('are still read from storage: they do no harm there, the browser drops them', () => {
    expect(
      ModelConfig.safeParse({
        id: 'a',
        baseURL: 'http://x.test',
        model: 'm',
        headers: { Host: 'h' },
      }).success,
    ).toBe(true);
  });
});

describe('extra body fields', () => {
  it('may not replace what the request sets itself, in a draft or a patch', () => {
    const draft = ModelConfigDraft.safeParse({
      baseURL: 'http://x.test',
      model: 'm',
      extraBody: { temperature: 0.2, messages: [] },
    });
    expect(draft.success).toBe(false);
    expect(draft.error?.issues).toMatchObject([{ path: ['extraBody', 'messages'] }]);
    expect(ModelConfigPatch.safeParse({ extraBody: { model: 'x' } }).success).toBe(false);
    expect(ModelConfigPatch.safeParse({ extraBody: { max_tokens: 100 } }).success).toBe(true);
  });

  it('are still read from storage; the request leaves a reserved one out', () => {
    const stored = { id: 'a', baseURL: 'http://x.test', model: 'm', extraBody: { stream: false } };
    expect(ModelConfig.safeParse(stored).success).toBe(true);
  });
});

describe('displayName', () => {
  it('falls back to the model name', () => {
    expect(displayName({ name: '  ', model: 'gpt-4o-mini' })).toBe('gpt-4o-mini');
    expect(displayName({ name: '工作', model: 'gpt-4o-mini' })).toBe('工作');
  });
});

describe('menuModelNames', () => {
  it('puts the model in use first when the list lacks it', () => {
    expect(menuModelNames({ model: 'a', menuModels: ['b', 'c'] })).toEqual(['a', 'b', 'c']);
  });

  it('keeps the list order when the model is on it, each name once', () => {
    expect(menuModelNames({ model: 'b', menuModels: ['a', 'b', 'a'] })).toEqual(['a', 'b']);
  });

  it('offers the model alone when the list is empty', () => {
    expect(menuModelNames({ model: 'a', menuModels: [] })).toEqual(['a']);
  });
});

describe('menuModels as submitted', () => {
  const base = { baseURL: 'http://x.test', model: 'm' };

  it('trims each name and refuses empty or repeated ones', () => {
    expect(ModelConfigDraft.parse({ ...base, menuModels: [' a '] }).menuModels).toEqual(['a']);
    expect(ModelConfigDraft.safeParse({ ...base, menuModels: [' '] }).success).toBe(false);
    expect(ModelConfigPatch.safeParse({ menuModels: ['a', 'a'] }).success).toBe(false);
  });
});
