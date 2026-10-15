import { useEffect, useState } from 'react';
import { GENERAL_SETTINGS_KEY } from '@/contract/general-settings';
import type { Locale } from '@/contract/rpc-wire';
import { locale as currentLocale, setLocale } from '@/domain/i18n';
import { htmlLang } from '@/domain/i18n/locale';
import { onStoredChange } from '@/platform/storage/watch';

/** Makes `locale` the language of `t` and of the page (`<html lang>`). */
export function applyLocale(locale: Locale, root: HTMLElement = document.documentElement): void {
  setLocale(locale);
  root.lang = htmlLang(locale);
}

/**
 * The interface language of an extension page, as the background resolves
 * it (`read`), applied and kept up to date: it is read again whenever the
 * general settings change, so a switch in the settings page reaches every
 * open page. Null until the first read settles; a page whose read fails
 * keeps the language it has.
 */
export function useLocale(read: () => Promise<Locale>): Locale | null {
  const [locale, setState] = useState<Locale | null>(null);

  useEffect(() => {
    let active = true;
    let latest = 0;
    const load = () => {
      const call = ++latest;
      read().then(
        (next) => {
          if (!active || call !== latest) return;
          applyLocale(next);
          setState(next);
        },
        () => {
          if (active && call === latest) setState((current) => current ?? currentLocale());
        },
      );
    };
    load();
    const stop = onStoredChange([GENERAL_SETTINGS_KEY], load);
    return () => {
      active = false;
      stop();
    };
  }, [read]);

  return locale;
}
