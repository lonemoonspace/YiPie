/**
 * Applies a partial update. Fields present in `patch` replace the current
 * values; absent or `undefined` fields leave them alone, and fields of
 * `current` that the patch does not know about survive.
 */
export function applyPatch<T extends object>(current: T, patch: Partial<T>): T {
  const next: T = { ...current };
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const value = patch[key];
    if (value !== undefined) next[key] = value;
  }
  return next;
}
