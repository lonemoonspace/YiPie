import { originPattern } from '@/domain/url';

/**
 * The host permission pattern a stored model configuration needs, read from
 * its `baseURL` alone, so an unrecognized row (one a newer version wrote, say)
 * still counts: its service is still the user's. `null` without a usable URL.
 */
export function neededOrigin(row: unknown): string | null {
  if (typeof row !== 'object' || row === null) return null;
  const baseURL = (row as { baseURL?: unknown }).baseURL;
  if (typeof baseURL !== 'string') return null;
  try {
    const { protocol } = new URL(baseURL);
    return protocol === 'http:' || protocol === 'https:' ? originPattern(baseURL) : null;
  } catch {
    return null;
  }
}

/**
 * Origins the rows needed before a change and no longer need after it: the
 * access that can be given back (docs/development-plan.md §4.3, decision 5).
 * An origin any remaining row uses is kept; this is the reference count.
 */
export function originsNoLongerNeeded(
  before: readonly unknown[],
  after: readonly unknown[],
): string[] {
  const still = new Set(after.map(neededOrigin));
  const released = new Set<string>();
  for (const origin of before.map(neededOrigin)) {
    if (origin !== null && !still.has(origin)) released.add(origin);
  }
  return [...released];
}
