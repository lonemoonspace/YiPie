/**
 * A copy of `value` without what may be a credential, for a file that leaves
 * the extension: exports leave credentials out unless the user asks for them
 * (docs/development-plan.md §8). Drops every `apiKey` and `headers` property
 * at any depth, and the query and fragment of every `baseURL` (a gateway may
 * take its key there). It reads nothing else of the value, so it also works on
 * backups of data no version could read.
 */
export function withoutCredentials(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutCredentials);
  if (typeof value !== 'object' || value === null) return value;
  // fromEntries defines a `__proto__` key as a plain property instead of
  // calling the prototype setter.
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'apiKey' && key !== 'headers')
      .map(([key, inner]) => [
        key,
        key === 'baseURL' && typeof inner === 'string'
          ? withoutQuery(inner)
          : withoutCredentials(inner),
      ]),
  );
}

function withoutQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}
