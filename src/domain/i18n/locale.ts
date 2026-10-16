import type { InterfaceLanguage } from '@/contract/general-settings';
import type { Locale } from '@/contract/rpc-wire';

/**
 * The interface language the settings ask for, on a browser whose own
 * language is `browserLanguage` (`i18n.getUILanguage()`): `auto` means
 * Chinese for any Chinese, English for everything else.
 */
export function resolveLocale(setting: InterfaceLanguage, browserLanguage: string): Locale {
  if (setting !== 'auto') return setting;
  return /^zh\b/i.test(browserLanguage.trim()) ? 'zh-Hans' : 'en';
}

/** The `lang` an extension page declares for this interface language. */
export function htmlLang(locale: Locale): string {
  return locale === 'zh-Hans' ? 'zh-CN' : 'en';
}
