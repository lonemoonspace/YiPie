import { useEffect, useState } from 'react';
import { hasOriginAccess } from '@/platform/permissions/origin-access';

/**
 * Which origins of `baseURLs` we hold the host permission for, keyed by
 * origin; an origin not yet checked is absent. Checks again when the set of
 * origins changes or `revision` moves on (a save may have just granted one).
 */
export function useOriginAccess(
  baseURLs: readonly string[],
  revision: number,
): ReadonlyMap<string, boolean> {
  const [access, setAccess] = useState<ReadonlyMap<string, boolean>>(new Map());
  const origins = [...new Set(baseURLs.map((url) => new URL(url).origin))].sort();
  const key = origins.join(' ');

  useEffect(() => {
    let active = true;
    const list = key === '' ? [] : key.split(' ');
    void Promise.all(
      list.map(async (origin) => [origin, await hasOriginAccess(origin)] as const),
    ).then((entries) => {
      if (active) setAccess(new Map(entries));
    });
    return () => {
      active = false;
    };
  }, [key, revision]);

  return access;
}
