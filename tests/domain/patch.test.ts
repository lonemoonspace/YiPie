import { describe, expect, it } from 'vitest';
import { applyPatch, changedFields } from '@/domain/patch';

describe('applyPatch', () => {
  const current = { theme: 'light', logLevel: 'debug' };

  it('replaces only the fields the patch names', () => {
    expect(applyPatch(current, { theme: 'dark' })).toEqual({ theme: 'dark', logLevel: 'debug' });
  });

  it('ignores fields set to undefined', () => {
    expect(applyPatch(current, { theme: undefined })).toEqual(current);
  });

  it('returns an equal copy for an empty patch, never the same object', () => {
    const next = applyPatch(current, {});
    expect(next).toEqual(current);
    expect(next).not.toBe(current);
  });

  it('keeps fields of the current value that the patch does not know about', () => {
    const withExtra = { ...current, addedByNewerVersion: 42 };
    expect(applyPatch(withExtra, { logLevel: 'warn' })).toEqual({
      theme: 'light',
      logLevel: 'warn',
      addedByNewerVersion: 42,
    });
  });
});

describe('changedFields', () => {
  interface Fields {
    name: string;
    apiKey: string;
    headers: Record<string, string>;
    contextWindow: number | null;
  }
  const stored: Fields = {
    name: '本地',
    apiKey: 'sk-1',
    headers: { 'X-A': '1' },
    contextWindow: null,
  };

  it('names only the fields the user changed', () => {
    expect(changedFields(stored, { ...stored, name: '改名' })).toEqual({ name: '改名' });
  });

  it('compares objects and null by value', () => {
    expect(changedFields(stored, { ...stored, headers: { 'X-A': '1' } })).toEqual({});
    expect(changedFields(stored, { ...stored, headers: {}, contextWindow: 8000 })).toEqual({
      headers: {},
      contextWindow: 8000,
    });
  });

  it('looks only at the edited fields, so stored extras are not sent back', () => {
    const withExtras = { ...stored, id: 'a', addedByNewerVersion: true };
    expect(changedFields<Fields>(withExtras, { ...stored, apiKey: 'sk-2' })).toEqual({
      apiKey: 'sk-2',
    });
  });
});
