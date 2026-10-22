import { describe, expect, it } from 'vitest';
import { withoutCredentials } from '@/domain/credentials';

describe('withoutCredentials', () => {
  it('drops keys and headers, and the query of a base URL, from model configurations', () => {
    const backup = {
      version: 1,
      data: [
        {
          id: 'a',
          name: '网关',
          baseURL: 'https://gw.example/v1?key=query-secret#frag',
          apiKey: 'sk-secret',
          headers: { 'X-API-Key': 'header-secret' },
          model: 'm',
        },
      ],
    };

    const stripped = withoutCredentials(backup);

    expect(stripped).toEqual({
      version: 1,
      data: [{ id: 'a', name: '网关', baseURL: 'https://gw.example/v1', model: 'm' }],
    });
    expect(JSON.stringify(stripped)).not.toMatch(/secret/);
  });

  it('drops the user name and password of a base URL', () => {
    expect(
      withoutCredentials([
        { baseURL: 'https://user:secret@gw.example/v1?x=1' },
        { baseURL: 'http://a:b@c@localhost:11434/v1' },
        { baseURL: 'https://gw.example/v1/user@name' },
      ]),
    ).toEqual([
      { baseURL: 'https://gw.example/v1' },
      { baseURL: 'http://localhost:11434/v1' },
      { baseURL: 'https://gw.example/v1/user@name' },
    ]);
  });

  it('works on values no version could read, at any depth', () => {
    expect(
      withoutCredentials(['x', 1, null, { nested: [{ apiKey: 7, keep: true }], baseURL: 3 }]),
    ).toEqual(['x', 1, null, { nested: [{ keep: true }], baseURL: 3 }]);
  });

  it('leaves values without credentials as they are', () => {
    const settings = { theme: 'dark', logLevel: 'info' };
    expect(withoutCredentials(settings)).toEqual(settings);
    expect(withoutCredentials('plain')).toBe('plain');
  });

  it('copies a `__proto__` key as data instead of changing the prototype', () => {
    const raw: unknown = JSON.parse('{"__proto__": {"polluted": true}, "apiKey": "k"}');
    const stripped = withoutCredentials(raw) as Record<string, unknown>;

    expect(Object.getPrototypeOf(stripped)).toBe(Object.prototype);
    expect(Object.hasOwn(stripped, '__proto__')).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
