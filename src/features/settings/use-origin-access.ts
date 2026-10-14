import { useEffect, useState } from 'react';
import { hasPatternAccess, onPermissionsChanged } from '@/platform/permissions/origin-access';

/**
 * Whether we hold host access for each origin pattern, kept current as the
 * browser grants or takes back permissions: after a prompt, from
 * `chrome://extensions`, or when the background gives back access that no
 * configuration needs any more.
 */
export function useOriginAccess(patterns: readonly string[]): ReadonlyMap<string, boolean> {
  const key = [...new Set(patterns)].sort().join('\n');
  const [access, setAccess] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [changes, setChanges] = useState(0);

  useEffect(() => onPermissionsChanged(() => setChanges((count) => count + 1)), []);

  useEffect(() => {
    let active = true;
    const wanted = key === '' ? [] : key.split('\n');
    void Promise.all(
      wanted.map(async (pattern) => [pattern, await hasPatternAccess(pattern)] as const),
    ).then((entries) => {
      if (active) setAccess(new Map(entries));
    });
    return () => {
      active = false;
    };
  }, [key, changes]);

  return access;
}
