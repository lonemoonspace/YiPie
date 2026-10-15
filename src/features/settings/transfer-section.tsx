import { useId, useRef, useState, type ChangeEvent } from 'react';
import { MAX_IMPORTED_ITEMS } from '@/contract/config-transfer';
import { buildConfigFile, previewImport, type ImportPreview } from '@/domain/config-transfer';
import { t } from '@/domain/i18n';
import { requestOriginsAccess } from '@/platform/permissions/origin-access';
import { callRpc } from '@/platform/rpc/client';
import { downloadJson } from './download';

type Ready = Extract<ImportPreview, { kind: 'ready' }>;

function fileName(at: Date): string {
  return `yipie-config-${at.toISOString().slice(0, 10)}.json`;
}

/**
 * Export and import of models and prompts (docs/development-plan.md §4.6).
 * The export leaves credentials out unless the user ticks the box (§8). An
 * import is read here and shown before anything is written; confirming sends
 * only the items that could be read, which the background appends with new
 * ids. A file with nothing readable is refused as a whole (§7).
 */
export function TransferSection() {
  const [withCredentials, setWithCredentials] = useState(false);
  const [pending, setPending] = useState<Ready | null>(null);
  const [status, setStatus] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const checkboxId = useId();
  const fileId = useId();

  const exportConfig = () => {
    setBusy(true);
    setStatus('');
    Promise.all([callRpc('models.list', {}), callRpc('prompts.list', {})])
      .then(([models, prompts]) => {
        const at = new Date();
        downloadJson(
          fileName(at),
          buildConfigFile(models.items, prompts.items, { withCredentials, at }),
        );
        const counts = {
          models: String(models.items.length),
          prompts: String(prompts.items.length),
        };
        setStatus(t(withCredentials ? 'transfer.exported' : 'transfer.exportedWithout', counts));
      })
      .catch((error: unknown) => setStatus(t('list.failed', { detail: messageOf(error) })))
      .finally(() => setBusy(false));
  };

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setPending(null);
    setProblem(null);
    setStatus('');
    if (file === undefined) return;
    file.text().then(
      (text) => {
        const preview = previewImport(text);
        if (preview.kind === 'ready') setPending(preview);
        else
          setProblem(t(`transfer.problem.${preview.problem}`, { max: String(MAX_IMPORTED_ITEMS) }));
      },
      (error: unknown) => setProblem(t('transfer.problem.read', { detail: messageOf(error) })),
    );
  };

  const reset = () => {
    setPending(null);
    if (fileInput.current) fileInput.current.value = '';
  };

  const confirmImport = (preview: Ready) => {
    // In the click, before any await: the browser asks only during a user
    // gesture. The import goes ahead either way, as a save does (model-form).
    void requestOriginsAccess(preview.models.map((model) => model.baseURL));
    setBusy(true);
    callRpc('config.import', { models: preview.models, prompts: preview.prompts })
      .then(
        () => {
          reset();
          setStatus(
            t('transfer.imported', {
              models: String(preview.models.length),
              prompts: String(preview.prompts.length),
            }),
          );
        },
        (error: unknown) => setStatus(t('list.failed', { detail: messageOf(error) })),
      )
      .finally(() => setBusy(false));
  };

  return (
    <section className="card" aria-labelledby="transfer-heading">
      <h2 id="transfer-heading">{t('transfer.section')}</h2>
      <p className="intro">{t('transfer.intro')}</p>

      <div className="field checkbox">
        <input
          id={checkboxId}
          type="checkbox"
          checked={withCredentials}
          onChange={(event) => setWithCredentials(event.target.checked)}
        />
        <label htmlFor={checkboxId}>{t('transfer.withCredentials')}</label>
      </div>
      <div className="actions transfer-actions">
        <button type="button" disabled={busy} onClick={exportConfig}>
          {t('transfer.export')}
        </button>
      </div>

      <div className="field transfer-file">
        <label htmlFor={fileId}>{t('transfer.file')}</label>
        <input
          ref={fileInput}
          id={fileId}
          type="file"
          accept="application/json,.json"
          disabled={busy}
          onChange={chooseFile}
        />
      </div>

      {problem !== null ? (
        <p role="alert" className="notice">
          {problem}
        </p>
      ) : null}

      {pending !== null ? (
        <div className="import-preview" data-import-preview>
          <p>
            {t('transfer.preview', {
              models: String(pending.models.length),
              prompts: String(pending.prompts.length),
              skipped: String(pending.skipped),
            })}
          </p>
          {pending.models.length > 0 ? (
            <p className="hint">
              {t(
                pending.withCredentials
                  ? 'transfer.preview.credentials'
                  : 'transfer.preview.noCredentials',
              )}
              {t('transfer.preview.access')}
            </p>
          ) : null}
          <div className="actions">
            <button type="button" disabled={busy} onClick={() => confirmImport(pending)}>
              {t('transfer.import')}
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={reset}>
              {t('transfer.cancel')}
            </button>
          </div>
        </div>
      ) : null}

      <p role="status" className="save-status">
        {status}
      </p>
    </section>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
