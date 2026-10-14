import { t } from '@/domain/i18n';
import { useAttach } from './use-attach';

export function PanelApp() {
  const attach = useAttach();

  return (
    <main className="panel" data-attach={attach.kind}>
      {attach.kind === 'attaching' ? (
        <p className="status">{t('panel.status.attaching')}</p>
      ) : attach.kind === 'failed' ? (
        <p role="alert" className="notice">
          {t('panel.attachFailed')}
        </p>
      ) : null}
    </main>
  );
}
