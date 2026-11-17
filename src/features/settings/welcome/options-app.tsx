import { useEffect, useState } from 'react';
import { parseWelcomeHash, type StartPath } from '@/domain/welcome-hash';
import { useLocale } from '@/features/i18n/locale';
import { SettingsPage } from '../settings-page';
import { callRpc } from '@/platform/rpc/client';
import { WelcomePage } from './welcome-page';

const readLocale = async () => (await callRpc('settings.get', {})).locale;

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
