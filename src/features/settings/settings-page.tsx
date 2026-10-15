import { useEffect } from 'react';
import { t } from '@/domain/i18n';
import { useLocale } from '@/features/i18n/locale';
import { callRpc } from '@/platform/rpc/client';
import { BackupsSection } from './backups-section';
import { GeneralSection } from './general-section';
import { ModelSection } from './model-section';
import { PromptSection } from './prompt-section';
import { TransferSection } from './transfer-section';

const readLocale = async () => (await callRpc('settings.get', {})).locale;

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
      <h1>{t('settings.title')}</h1>
      <ModelSection />
      <PromptSection />
      <GeneralSection />
      <TransferSection />
      <BackupsSection />
    </main>
  );
}
