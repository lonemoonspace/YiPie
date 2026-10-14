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

/**
 * The fields of `edited` whose value differs from `current`. Saving an edit
 * form sends only these, so a field changed meanwhile in another tab is not
 * set back to what this form showed. Values compare as JSON.
 */
export function changedFields<F extends object>(current: F, edited: F): Partial<F> {
  const patch: Partial<F> = {};
  for (const key of Object.keys(edited) as (keyof F)[]) {
    if (JSON.stringify(current[key]) !== JSON.stringify(edited[key])) patch[key] = edited[key];
  }
  return patch;
}
