import { useCallback, useState } from 'react';
import { t } from '@/domain/i18n';
import { BackupsSection } from './backups-section';
import { GeneralSection } from './general-section';
import { ModelsSection } from './models-section';
import { PromptsSection } from './prompts-section';

export function SettingsPage() {
  // Moves on when a save backed up an unreadable value, so the backups list reloads.
  const [backups, setBackups] = useState(0);
  const backedUp = useCallback(() => setBackups((count) => count + 1), []);

  return (
    <main className="page">
      <h1>{t('settings.title')}</h1>
      <ModelsSection onBackedUp={backedUp} />
      <PromptsSection onBackedUp={backedUp} />
      <GeneralSection onBackedUp={backedUp} />
      <BackupsSection revision={backups} />
    </main>
  );
}
