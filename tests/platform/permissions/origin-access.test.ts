import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  hasOriginAccess,
  requestOriginAccess,
  type PermissionsLike,
} from '@/platform/permissions/origin-access';

/** A gateway that takes its key in the query, which must stay out of logs. */
const BASE_URL = 'https://gw.example:8443/v1?key=query-secret#part';

function permissions(overrides: Partial<PermissionsLike> = {}) {
  return {
    request: vi.fn(() => Promise.resolve(true)),
    contains: vi.fn(() => Promise.resolve(true)),
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
