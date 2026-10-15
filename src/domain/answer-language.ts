import type { AnswerLanguage } from '@/contract/general-settings';

/** A language the settings name, as the interface writes its name. */
export type NamedLanguage = Exclude<AnswerLanguage, 'interface' | 'page'>;

/**
 * Which language answers are written in, before it is put into words: the
 * interface's, one the settings name, or the page's own language tag. A
 * page that declares no usable language falls back to the interface's.
 */
export type ResolvedLanguage =
  { kind: 'interface' } | { kind: 'named'; language: NamedLanguage } | { kind: 'tag'; tag: string };

/** A BCP 47 tag as a page would write it: letters, digits and hyphens. */
const LANGUAGE_TAG = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;

export function resolveAnswerLanguage(setting: AnswerLanguage, pageLang: string): ResolvedLanguage {
  if (setting === 'interface') return { kind: 'interface' };
  if (setting !== 'page') return { kind: 'named', language: setting };
  const tag = pageLang.trim().replace(/_/g, '-');
  return LANGUAGE_TAG.test(tag) ? { kind: 'tag', tag } : { kind: 'interface' };
}
