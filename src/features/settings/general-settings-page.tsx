import { useEffect } from 'react';
import { LogLevel, Theme } from '@/contract/general-settings';
import { t } from '@/domain/i18n';
import { applyTheme } from '@/features/theme/apply-theme';
import { useGeneralSettings, type SaveState } from './use-general-settings';

export function GeneralSettingsPage() {
  const { view, loadError, save, update } = useGeneralSettings();
  const theme = view?.settings.theme;

  useEffect(() => {
    if (theme) applyTheme(theme);
  }, [theme]);

  if (loadError !== null) {
    return (
      <main className="page">
        <h1>{t('settings.title')}</h1>
        <p role="alert" className="notice">
          {t('settings.loadFailed', { detail: loadError })}
        </p>
      </main>
    );
  }

  if (view === null) {
    return (
      <main className="page">
        <h1>{t('settings.title')}</h1>
        <p>{t('settings.loading')}</p>
      </main>
    );
  }

  const disabled = view.readOnly || save.kind === 'saving';

  return (
    <main className="page">
      <h1>{t('settings.title')}</h1>

      {view.readOnly ? (
        <p role="alert" className="notice">
          {t('settings.readOnly')}
        </p>
      ) : view.status === 'invalid' ? (
        <p role="alert" className="notice">
          {t('settings.invalid')}
        </p>
      ) : null}

      <section className="card" aria-labelledby="general-heading">
        <h2 id="general-heading">{t('settings.general')}</h2>

        <div className="field">
          <label htmlFor="theme">{t('settings.theme')}</label>
          <select
            id="theme"
            value={view.settings.theme}
            disabled={disabled}
            onChange={(event) => void update({ theme: Theme.parse(event.target.value) })}
          >
            {Theme.options.map((option) => (
              <option key={option} value={option}>
                {t(`settings.theme.${option}`)}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="log-level">{t('settings.logLevel')}</label>
          <select
            id="log-level"
            value={view.settings.logLevel}
            disabled={disabled}
            onChange={(event) => void update({ logLevel: LogLevel.parse(event.target.value) })}
          >
            {LogLevel.options.map((option) => (
              <option key={option} value={option}>
                {t(`settings.logLevel.${option}`)}
              </option>
            ))}
          </select>
        </div>
      </section>

      <p role="status" className="save-status">
        {describeSave(save)}
      </p>
    </main>
  );
}

function describeSave(save: SaveState): string {
  switch (save.kind) {
    case 'idle':
      return '';
    case 'saving':
      return t('settings.saving');
    case 'saved':
      return save.quarantined ? t('settings.savedQuarantined') : t('settings.saved');
    case 'failed':
      return t('settings.saveFailed', { detail: save.message });
  }
}
