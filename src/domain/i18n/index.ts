import { zh } from './zh';

export type MessageKey = keyof typeof zh;

/** Every table for another language must have exactly these keys. */
export type Messages = Record<MessageKey, string>;

export type MessageParams = Record<string, string | number>;

/**
 * The text for `key`, with each `{name}` replaced by `params.name`. A
 * placeholder without a parameter stays as written, so a missing value is
 * visible instead of silently blank.
 */
export function t(key: MessageKey, params: MessageParams = {}): string {
  const table: Messages = zh;
  return table[key].replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : placeholder,
  );
}
