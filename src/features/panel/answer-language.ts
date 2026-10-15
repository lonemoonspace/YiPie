import type { ResolvedLanguage } from '@/domain/answer-language';
import { t } from '@/domain/i18n';

/**
 * The name of the language to answer in, as `{{language}}` puts it into the
 * prompt: in the interface's language, which the built-in prompt is written in.
 */
export function answerLanguageName(language: ResolvedLanguage): string {
  switch (language.kind) {
    case 'interface':
      return t('prompt.answerLanguage');
    case 'named':
      return t(`language.${language.language}`);
    case 'tag':
      return displayName(language.tag) ?? t('prompt.answerLanguage');
  }
}

function displayName(tag: string): string | null {
  try {
    return new Intl.DisplayNames(['zh-Hans'], { type: 'language' }).of(tag) ?? null;
  } catch {
    // Not a tag the browser knows.
    return null;
  }
}
