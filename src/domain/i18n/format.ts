export type MessageParams = Record<string, string | number>;

/**
 * A `t` for one table of messages: the text for `key`, with each `{name}`
 * replaced by `params.name`. A placeholder without a parameter stays as
 * written, so a missing value is visible instead of silently blank.
 */
export function translator<Key extends string>(table: Readonly<Record<Key, string>>) {
  return (key: Key, params: MessageParams = {}): string =>
    table[key].replace(/\{(\w+)\}/g, (placeholder, name: string) =>
      Object.hasOwn(params, name) ? String(params[name]) : placeholder,
    );
}
