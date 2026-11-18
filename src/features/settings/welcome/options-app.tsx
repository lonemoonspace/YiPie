import { useEffect, useState } from 'react';
import { parseWelcomeHash, type StartPath } from '@/domain/welcome-hash';
import { useLocale } from '@/features/i18n/locale';
import { applyTheme } from '@/features/theme/apply-theme';
import { SettingsPage } from '../settings-page';
import { callRpc } from '@/platform/rpc/client';
import { WelcomePage } from './welcome-page';

/** Reads the settings once for both: the language, and the theme applied on the way. */
const readLocale = async () => {
  const view = await callRpc('settings.get', {});
  applyTheme(view.settings.theme);
  return view.locale;
};

/** The first-run page in the interface language, once that is known. */
function Welcome({ path }: { path: StartPath | null }) {
  const locale = useLocale(readLocale);
  if (locale === null) return null;
  return <WelcomePage key={locale} initial={path} />;
}

/**
 * The settings page, or the first-run page when its hash is `#welcome`
 * (`#welcome/<path>` opens one of its paths): the background opens it after
 * install, the panel links to it while no model is set up. Any other hash
 * is a link to a settings section.
 */
export function OptionsApp() {
  const [hash, setHash] = useState(() => window.location.hash);

  useEffect(() => {
    const follow = () => setHash(window.location.hash);
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);

  const welcome = parseWelcomeHash(hash);
  return welcome === null ? <SettingsPage /> : <Welcome key={hash} path={welcome.path} />;
}
