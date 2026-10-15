import type { Locale } from '@/contract/rpc-wire';

export type MessageParams = Record<string, string | number>;

/** One table of messages in every interface language, with the same keys. */
export type LocalizedTables<Key extends string> = Readonly<
  Record<Locale, Readonly<Record<Key, string>>>
>;

/**
 * Text for one context's messages in the current interface language
 * (docs/development-plan.md §4.7). Each context (extension pages, the
 * service worker, the content script) has its own, set once it has read the
 * settings; until then it speaks Chinese, the language the extension began in.
 */
export function translator<Key extends string>(tables: LocalizedTables<Key>) {
  let current: Locale = 'zh-Hans';
  return {
    /**
     * The text for `key`, with each `{name}` replaced by `params.name`. A
     * placeholder without a parameter stays as written, so a missing value is
     * visible instead of silently blank.
     */
    t: (key: Key, params: MessageParams = {}): string => fill(tables[current][key], params),
    setLocale: (locale: Locale): void => {
      current = locale;
    },
    locale: (): Locale => current,
  };
}

function fill(text: string, params: MessageParams): string {
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : placeholder,
  );
}
