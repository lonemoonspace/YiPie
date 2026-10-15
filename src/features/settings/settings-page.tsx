import { t } from '@/domain/i18n';
import { BackupsSection } from './backups-section';
import { GeneralSection } from './general-section';
import { ModelSection } from './model-section';
import { PromptSection } from './prompt-section';
import { TransferSection } from './transfer-section';

export function SettingsPage() {
  return (
    <main className="page">
      <h1>{t('settings.title')}</h1>
      <ModelSection />
      <PromptSection />
      <GeneralSection />
      <TransferSection />
      <BackupsSection />
    </main>
  );
}
