import { describe, expect, it, vi } from 'vitest';
import { createIsolationGate, type AccessLevelArea } from '@/platform/storage';

describe('createIsolationGate', () => {
  it('asks the browser to close storage.local to content scripts', async () => {
    const setAccessLevel = vi.fn<AccessLevelArea['setAccessLevel']>(() => Promise.resolve());

    await createIsolationGate({ setAccessLevel })();

    expect(setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
  });

  it('asks once, however many callers wait, as long as the answer is yes', async () => {
    const setAccessLevel = vi.fn<AccessLevelArea['setAccessLevel']>(() => Promise.resolve());
    const isolated = createIsolationGate({ setAccessLevel });

    await Promise.all([isolated(), isolated()]);
    await isolated();

    expect(setAccessLevel).toHaveBeenCalledOnce();
  });

  it('stays closed after a refusal and asks again on the next call', async () => {
    const setAccessLevel = vi
      .fn<AccessLevelArea['setAccessLevel']>()
      .mockRejectedValueOnce(new Error('not now'))
      .mockResolvedValueOnce(undefined);
    const isolated = createIsolationGate({ setAccessLevel });

    await expect(isolated()).rejects.toThrow('not now');
    await expect(isolated()).resolves.toBeUndefined();
    expect(setAccessLevel).toHaveBeenCalledTimes(2);
  });

  it('reports an API this browser lacks as a rejection, not a throw', async () => {
    const isolated = createIsolationGate({
      setAccessLevel: () => {
        throw new TypeError('setAccessLevel is not a function');
      },
    });

    const waiting = isolated();

    await expect(waiting).rejects.toThrow(TypeError);
  });
});
