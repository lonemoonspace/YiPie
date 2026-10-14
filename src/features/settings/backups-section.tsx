import { useEffect, useState } from 'react';
import type { Backup, BackupsView } from '@/contract/backups';
import { t } from '@/domain/i18n';
import { callRpc } from '@/platform/rpc/client';
import { downloadJson } from './download';

type Status =
  { kind: 'idle' } | { kind: 'busy' } | { kind: 'removed' } | { kind: 'failed'; message: string };

/**
 * The backups of unreadable values (docs/development-plan.md §7): see them,
 * export them, delete them. `revision` moves on when another section's save
 * backed something up, so the list is read again.
 */
export function BackupsSection({ revision }: { revision: number }) {
  const [view, setView] = useState<BackupsView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    callRpc('backups.list', {}).then(
      (loaded) => active && setView(loaded),
      (error: unknown) => active && setLoadError(messageOf(error)),
    );
    return () => {
      active = false;
    };
  }, [revision]);

  const remove = async (backup: Backup) => {
    setStatus({ kind: 'busy' });
    try {
      const { key, index, at } = backup;
      setView(await callRpc('backups.remove', { key, index, at }));
      setStatus({ kind: 'removed' });
    } catch (error) {
      setStatus({ kind: 'failed', message: messageOf(error) });
    }
  };

  return (
    <section className="card" aria-labelledby="backups-heading">
      <h2 id="backups-heading">{t('backups.section')}</h2>
      <p className="intro">{t('backups.intro')}</p>
      {loadError !== null ? (
        <p role="alert" className="notice">
          {t('settings.loadFailed', { detail: loadError })}
        </p>
      ) : view === null ? (
        <p>{t('settings.loading')}</p>
      ) : view.backups.length === 0 ? (
        <p className="hint">{t('backups.empty')}</p>
      ) : (
        <ul className="rows">
          {view.backups.map((backup) => {
            const id = `${backup.key}#${backup.index}`;
            const label = t(`backups.key.${keyName(backup.key)}`);
            return (
              <li key={id} className="row" aria-label={`${label} ${describeTime(backup.at)}`}>
                <div className="row-head">
                  <div className="row-text">
                    <span className="row-name">{label}</span>
                    <div className="row-detail">{describeTime(backup.at)}</div>
                  </div>
                  <div className="row-actions">
                    {confirming === id ? (
                      <>
                        <button
                          type="button"
                          className="danger"
                          disabled={status.kind === 'busy'}
                          onClick={() => {
                            setConfirming(null);
                            void remove(backup);
                          }}
                        >
                          {t('list.confirmRemove')}
                        </button>
                        <button type="button" className="quiet" onClick={() => setConfirming(null)}>
                          {t('list.cancel')}
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="quiet"
                          onClick={() =>
                            downloadJson(fileName(backup), {
                              key: backup.key,
                              at: backup.at,
                              raw: backup.raw,
                            })
                          }
                        >
                          {t('backups.export')}
                        </button>
                        <button
                          type="button"
                          className="quiet"
                          disabled={status.kind === 'busy'}
                          onClick={() => setConfirming(id)}
                        >
                          {t('list.remove')}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p role="status" className="save-status">
        {status.kind === 'removed'
          ? t('backups.removed')
          : status.kind === 'failed'
            ? t('list.failed', { detail: status.message })
            : ''}
      </p>
    </section>
  );
}

/** `local:model-configs` → `model-configs`. */
function keyName(key: Backup['key']) {
  return key.slice(key.indexOf(':') + 1) as
    'general-settings' | 'model-configs' | 'prompt-configs' | 'selection';
}

function describeTime(at: string): string {
  const time = new Date(at);
  if (Number.isNaN(time.getTime())) return t('backups.atUnknown');
  return t('backups.at', {
    time: time.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'medium' }),
  });
}

function fileName(backup: Backup): string {
  const stamp = backup.at.replace(/[^0-9A-Za-z]/g, '');
  return `yipie-backup-${keyName(backup.key)}-${stamp || backup.index}.json`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
