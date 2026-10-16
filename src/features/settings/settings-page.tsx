import { useEffect, useState } from 'react';
import { t } from '@/domain/i18n';
import { useLocale } from '@/features/i18n/locale';
import { callRpc } from '@/platform/rpc/client';
import { BackupsSection } from './backups-section';
import { GeneralSection } from './general-section';
import { ModelSection } from './model-section';
import { PromptSection } from './prompt-section';
import { TransferSection } from './transfer-section';

const readLocale = async () => (await callRpc('settings.get', {})).locale;

/** The sections, by the id of their heading, as the navigation lists them. */
const SECTIONS = [
  ['model-heading', 'model.section'],
  ['prompt-heading', 'prompt.section'],
  ['general-heading', 'settings.general'],
  ['transfer-heading', 'transfer.section'],
  ['backup-heading', 'backup.section'],
] as const;

/**
 * Links to each section that stay at the top while the page scrolls, the
 * one being read marked. Every section stays on the page: the links only
 * take the reader there.
 */
function SectionNav() {
  const [current, setCurrent] = useState<string>(SECTIONS[0][0]);

  useEffect(() => {
    const onScroll = () => {
      // The last section whose heading has passed below the navigation.
      let reading: string = SECTIONS[0][0];
      for (const [id] of SECTIONS) {
        const heading = document.getElementById(id);
        if (heading !== null && heading.getBoundingClientRect().top < 120) reading = id;
      }
      setCurrent(reading);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav className="sections" aria-label={t('settings.sections')}>
      {SECTIONS.map(([id, label]) => (
        <a key={id} href={`#${id}`} aria-current={id === current ? 'location' : undefined}>
          {t(label)}
        </a>
      ))}
    </nav>
  );
}

export function SettingsPage() {
  const locale = useLocale(readLocale);

  useEffect(() => {
    if (locale !== null) document.title = `${t('app.name')} · ${t('settings.title')}`;
  }, [locale]);

  // Nothing until the language is known, so no text shows in the wrong one.
  if (locale === null) return null;

  // A new language renders the page afresh: forms and notes keep no words
  // in the old one.
  return (
    <main className="page" key={locale}>
      <header className="masthead">
        <div className="title">
          <img className="logo" src="/icon/48.png" alt="" width="28" height="28" />
          <span className="app-name">{t('app.name')}</span>
          <h1>{t('settings.title')}</h1>
        </div>
        <SectionNav />
      </header>
      <ModelSection />
      <PromptSection />
      <GeneralSection />
      <TransferSection />
      <BackupsSection />
    </main>
  );
}
