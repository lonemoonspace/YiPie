import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  hasOriginAccess,
  releaseOriginAccess,
  requestOriginAccess,
  requestOriginsAccess,
  type PermissionsLike,
} from '@/platform/permissions/origin-access';

/** A gateway that takes its key in the query, which must stay out of logs. */
const BASE_URL = 'https://gw.example:8443/v1?key=query-secret#part';

function permissions(overrides: Partial<PermissionsLike> = {}) {
  return {
    request: vi.fn(() => Promise.resolve(true)),
    contains: vi.fn(() => Promise.resolve(true)),
    remove: vi.fn(() => Promise.resolve(true)),
    ...overrides,
  } satisfies PermissionsLike;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('origin access', () => {
  it('asks about the origin of the base URL, port included, and nothing wider', async () => {
    const api = permissions();

    expect(await requestOriginAccess(BASE_URL, api)).toBe(true);
    expect(await hasOriginAccess(BASE_URL, api)).toBe(true);

    expect(api.request).toHaveBeenCalledWith({ origins: ['https://gw.example:8443/*'] });
    expect(api.contains).toHaveBeenCalledWith({ origins: ['https://gw.example:8443/*'] });
  });

  it('answers false when the browser fails, logging the origin but not the base URL', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const api = permissions({
      request: () => Promise.reject(new Error('not in a user gesture')),
      contains: () => Promise.reject(new Error('unavailable')),
    });

    expect(await requestOriginAccess(BASE_URL, api)).toBe(false);
    expect(await hasOriginAccess(BASE_URL, api)).toBe(false);

    expect(warn).toHaveBeenCalledTimes(2);
    const logged = warn.mock.calls.flat().map(String).join(' ');
    expect(logged).toContain('https://gw.example:8443/*');
    expect(logged).not.toContain('query-secret');
    expect(logged).not.toContain('#part');
  });
});

describe('releasing origin access', () => {
  it('gives back each pattern on its own', async () => {
    const remove = vi.fn(() => Promise.resolve(true));

    await releaseOriginAccess(
      ['https://a.example/*', 'http://localhost:11434/*'],
      permissions({ remove }),
    );

    expect(remove.mock.calls).toEqual([
      [{ origins: ['https://a.example/*'] }],
      [{ origins: ['http://localhost:11434/*'] }],
    ]);
  });

  it('keeps going past a pattern the browser will not drop, and never throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const api = permissions({
      remove: vi.fn(({ origins }: { origins: string[] }) =>
        origins[0] === 'http://127.0.0.1/*'
          ? Promise.reject(new Error('You cannot remove required permissions.'))
          : Promise.resolve(true),
      ),
    });

    await expect(
      releaseOriginAccess(['http://127.0.0.1/*', 'https://b.example/*'], api),
    ).resolves.toBeUndefined();

    expect(api.remove).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.flat().map(String).join(' ')).toContain('http://127.0.0.1/*');
  });
});

describe('requestOriginsAccess', () => {
  it('asks once for every origin, each named once', async () => {
    const api = permissions();

    expect(
      await requestOriginsAccess(
        [BASE_URL, 'https://gw.example:8443/other', 'http://localhost:11434/v1'],
        api,
      ),
    ).toBe(true);

    expect(api.request).toHaveBeenCalledTimes(1);
    expect(api.request).toHaveBeenCalledWith({
      origins: ['https://gw.example:8443/*', 'http://localhost:11434/*'],
    });
  });

  it('asks nothing when there is nothing to ask for', async () => {
    const api = permissions();

    expect(await requestOriginsAccess([], api)).toBe(true);
    expect(api.request).not.toHaveBeenCalled();
  });

  it('answers false when the browser fails, logging origins only', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const api = permissions({ request: () => Promise.reject(new Error('no gesture')) });

    expect(await requestOriginsAccess([BASE_URL], api)).toBe(false);
    expect(warn.mock.calls.flat().map(String).join(' ')).not.toContain('query-secret');
    warn.mockRestore();
  });
});
