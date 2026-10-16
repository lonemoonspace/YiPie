import { useCallback, useEffect, useId, useState } from 'react';
import {
  BACKED_UP_KEYS,
  type BackedUpKey,
  type Backup,
  type BackupsView,
} from '@/contract/backups';
import { withoutCredentials } from '@/domain/credentials';
import { locale, t, type MessageKey } from '@/domain/i18n';
import { htmlLang } from '@/domain/i18n/locale';
import { callRpc } from '@/platform/rpc/client';
import { quarantineKeyFor } from '@/platform/storage/quarantine';
import { onStoredChange } from '@/platform/storage/watch';
import { downloadJson } from './download';

const LABELS: Record<BackedUpKey, MessageKey> = {
  'local:model-configs': 'backup.key.models',
  'local:prompt-configs': 'backup.key.prompts',
  'local:selection': 'backup.key.selection',
  'local:general-settings': 'backup.key.general',
};

/** Characters of a backup shown on the page; the export has all of it. */
const PREVIEW_LIMIT = 4000;

const nameOf = (backup: Backup) => t(LABELS[backup.key]);

function timeOf(backup: Backup): string {
  const time = new Date(backup.at);
  return Number.isNaN(time.getTime())
    ? t('backup.atUnknown')
    : time.toLocaleString(htmlLang(locale()), { hour12: false });
}

function fileNameOf(backup: Backup): string {
  const record = backup.key.slice(backup.key.indexOf(':') + 1);
  return `yipie-backup-${record}-${backup.at.replace(/[:.]/g, '-')}.json`;
}

function preview(raw: unknown): string {
  const text = JSON.stringify(withoutCredentials(raw), null, 2) ?? String(raw);
  return text.length > PREVIEW_LIMIT
    ? `${text.slice(0, PREVIEW_LIMIT)}\n${t('backup.truncated')}`
    : text;
}

/**
 * Backups of values that could not be read, taken before a save replaced
 * them (docs/development-plan.md §7): seen here, exported, and deleted only
 * by the user. The preview never shows credentials; the export leaves them
 * out unless the user asks (§8).
 */
export function BackupsSection() {
  const [view, setView] = useState<BackupsView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [withCredentials, setWithCredentials] = useState(false);
  const checkboxId = useId();

  const reload = useCallback(() => {
    callRpc('backups.list', {}).then(
      (loaded) => {
        setView(loaded);
        setLoadError(null);
      },
      (error: unknown) => setLoadError(messageOf(error)),
    );
  }, []);

  useEffect(() => {
    reload();
    // A save in another section (or tab) may have just taken a backup.
    return onStoredChange(BACKED_UP_KEYS.map(quarantineKeyFor), reload);
  }, [reload]);

  const exportBackup = (backup: Backup) => {
    const raw = withCredentials ? backup.raw : withoutCredentials(backup.raw);
    downloadJson(fileNameOf(backup), { key: backup.key, at: backup.at, raw });
    setStatus(t('backup.exported'));
  };

  const remove = (backup: Backup) => {
    const question = t('backup.confirmRemove', { name: nameOf(backup), time: timeOf(backup) });
    if (!window.confirm(question)) return;
    setBusy(true);
    callRpc('backups.remove', { key: backup.key, at: backup.at })
      .then(
        (next) => {
          setView(next);
          setStatus(t('backup.removed'));
        },
        (error: unknown) => setStatus(t('list.failed', { detail: messageOf(error) })),
      )
      .finally(() => setBusy(false));
  };

  return (
    <section className="card" aria-labelledby="backup-heading">
      <h2 id="backup-heading">{t('backup.section')}</h2>
      <p className="intro">{t('backup.intro')}</p>
      {loadError !== null ? (
        <p role="alert" className="notice">
          {t('settings.loadFailed', { detail: loadError })}
        </p>
      ) : view === null ? (
        <p>{t('settings.loading')}</p>
      ) : view.backups.length === 0 ? (
        <p className="hint list-note">{t('backup.none')}</p>
      ) : (
        <>
          <ul className="items" aria-label={t('backup.section')}>
            {view.backups.map((backup, index) => {
              const name = nameOf(backup);
              const time = timeOf(backup);
              return (
                <li key={`${backup.key}-${backup.at}-${index}`} className="item">
                  <div className="item-main">
                    <span className="item-name">{name}</span>
                    <span className="item-details">{t('backup.at', { time })}</span>
                  </div>
                  <details>
                    <summary className="hint">{t('backup.preview')}</summary>
                    <pre className="backup-preview">{preview(backup.raw)}</pre>
                  </details>
                  <div className="item-actions">
                    <button
                      type="button"
                      className="secondary"
                      aria-label={t('backup.export.label', { name, time })}
                      onClick={() => exportBackup(backup)}
                    >
                      {t('backup.export')}
                    </button>
                    <button
                      type="button"
                      className="secondary danger"
                      aria-label={t('backup.remove.label', { name, time })}
                      disabled={busy}
                      onClick={() => remove(backup)}
                    >
                      {t('list.remove')}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="field checkbox">
            <input
              id={checkboxId}
              type="checkbox"
              checked={withCredentials}
              onChange={(event) => setWithCredentials(event.target.checked)}
            />
            <label htmlFor={checkboxId}>{t('backup.withCredentials')}</label>
          </div>
        </>
      )}
      <p role="status" className="save-status">
        {status}
      </p>
    </section>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
