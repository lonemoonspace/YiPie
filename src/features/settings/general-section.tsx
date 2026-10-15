import { useEffect } from 'react';
import {
  AnswerLanguage,
  FontSize,
  LogLevel,
  Theme,
  TrimmingStrategy,
  type AnswerLanguage as AnswerLanguageValue,
} from '@/contract/general-settings';
import { DEFAULT_CONTEXT_WINDOW } from '@/domain/budget';
import { t, type MessageKey } from '@/domain/i18n';
import { applyTheme } from '@/features/theme/apply-theme';
import { useGeneralSettings, type SaveState } from './use-general-settings';

export function GeneralSection() {
  const { view, loadError, save, update } = useGeneralSettings();
  const theme = view?.settings.theme;

  useEffect(() => {
    if (theme) applyTheme(theme);
  }, [theme]);

  const disabled = view === null || view.readOnly || save.kind === 'saving';

  return (
    <section className="card" aria-labelledby="general-heading">
      <h2 id="general-heading">{t('settings.general')}</h2>

      {loadError !== null ? (
        <p role="alert" className="notice">
          {t('settings.loadFailed', { detail: loadError })}
        </p>
      ) : view === null ? (
        <p>{t('settings.loading')}</p>
      ) : (
        <>
          {view.readOnly ? (
            <p role="alert" className="notice">
              {t('settings.readOnly')}
            </p>
          ) : view.status === 'invalid' ? (
            <p role="alert" className="notice">
              {t('settings.invalid')}
            </p>
          ) : null}

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
            <label htmlFor="font-size">{t('settings.fontSize')}</label>
            <select
              id="font-size"
              value={view.settings.fontSize}
              disabled={disabled}
              onChange={(event) => void update({ fontSize: FontSize.parse(event.target.value) })}
            >
              {FontSize.options.map((option) => (
                <option key={option} value={option}>
                  {t(`settings.fontSize.${option}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="answer-language">{t('settings.answerLanguage')}</label>
            <select
              id="answer-language"
              value={view.settings.answerLanguage}
              disabled={disabled}
              aria-describedby="answer-language-hint"
              onChange={(event) =>
                void update({ answerLanguage: AnswerLanguage.parse(event.target.value) })
              }
            >
              {AnswerLanguage.options.map((option) => (
                <option key={option} value={option}>
                  {t(languageLabel(option))}
                </option>
              ))}
            </select>
            <p id="answer-language-hint" className="hint">
              {t('settings.answerLanguage.hint')}
            </p>
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

          <div className="field">
            <label htmlFor="trimming">{t('settings.trimming')}</label>
            <select
              id="trimming"
              value={view.settings.trimming}
              disabled={disabled}
              aria-describedby="trimming-hint"
              onChange={(event) =>
                void update({ trimming: TrimmingStrategy.parse(event.target.value) })
              }
            >
              {TrimmingStrategy.options.map((option) => (
                <option key={option} value={option}>
                  {t(`settings.trimming.${option}`)}
                </option>
              ))}
            </select>
            <p id="trimming-hint" className="hint">
              {t('settings.trimming.hint', {
                window: DEFAULT_CONTEXT_WINDOW.toLocaleString('en-US'),
              })}
            </p>
          </div>

          <p role="status" className="save-status">
            {describeSave(save)}
          </p>
        </>
      )}
    </section>
  );
}

function languageLabel(option: AnswerLanguageValue): MessageKey {
  return option === 'interface' || option === 'page'
    ? `settings.answerLanguage.${option}`
    : `language.${option}`;
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
