import { describe, expect, it } from 'vitest';
import { applyPatch } from '@/domain/patch';

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
