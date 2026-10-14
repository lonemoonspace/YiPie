import { describe, expect, it } from 'vitest';
import { neededOrigin, originsNoLongerNeeded } from '@/domain/origins';

const row = (baseURL: unknown) => ({ id: String(baseURL), baseURL });

describe('neededOrigin', () => {
  it('is the origin pattern of the base URL, port included', () => {
    expect(neededOrigin(row('http://localhost:11434/v1?key=x'))).toBe('http://localhost:11434/*');
    expect(neededOrigin(row('https://API.example.com:443/v1'))).toBe('https://api.example.com/*');
  });

  it('is nothing for a row without a usable http(s) URL', () => {
    for (const value of [row('not a url'), row('file:///x'), row(42), { id: 'a' }, null, 'x']) {
      expect(neededOrigin(value)).toBeNull();
    }
  });
});

describe('originsNoLongerNeeded', () => {
  const openai = row('https://api.openai.com/v1');
  const ollama = row('http://localhost:11434/v1');
  const ollamaToo = row('http://localhost:11434/api');

  it('releases the origin of a removed configuration nothing else uses', () => {
    expect(originsNoLongerNeeded([openai, ollama], [ollama])).toEqual(['https://api.openai.com/*']);
  });

  it('keeps an origin another configuration still uses', () => {
    expect(originsNoLongerNeeded([ollama, ollamaToo], [ollamaToo])).toEqual([]);
  });

  it('keeps an origin an unrecognized row still uses', () => {
    const fromNewerVersion = { baseURL: 'https://api.openai.com/v1', shape: 'unknown' };
    expect(originsNoLongerNeeded([openai, fromNewerVersion], [fromNewerVersion])).toEqual([]);
  });

  it('releases the old origin when a base URL moves elsewhere', () => {
    expect(originsNoLongerNeeded([ollama], [row('http://localhost:8000/v1')])).toEqual([
      'http://localhost:11434/*',
    ]);
  });

  it('releases nothing when nothing changed', () => {
    expect(originsNoLongerNeeded([openai, ollama], [ollama, openai])).toEqual([]);
  });
});
