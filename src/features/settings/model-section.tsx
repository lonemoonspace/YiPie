import { displayName, type ModelConfig } from '@/contract/model-config';
import { t } from '@/domain/i18n';
import { changedFields } from '@/domain/patch';
import { originPattern } from '@/domain/url';
import { requestOriginAccess } from '@/platform/permissions/origin-access';
import { callRpc } from '@/platform/rpc/client';
import { EditableList, type ListCalls } from './editable-list';
import { ModelForm } from './model-form';
import { describeStatus, useConfigList } from './use-config-list';
import { useOriginAccess } from './use-origin-access';

const loadModels = () => callRpc('models.list', {});

const calls: ListCalls<ModelConfig> = {
  remove: (id) => callRpc('models.remove', { id }),
  move: (id, direction) => callRpc('models.move', { id, direction }),
  setDefault: (id) => callRpc('models.setDefault', { id }),
};

/** Model configurations: a list with a default (docs/development-plan.md §4.3). */
export function ModelSection() {
  const list = useConfigList(loadModels);
  const { view, change } = list;
  const busy = list.status.kind === 'busy';
  const access = useOriginAccess(view?.items.map((config) => originPattern(config.baseURL)) ?? []);
  const missing = (config: ModelConfig) => access.get(originPattern(config.baseURL)) === false;

  return (
    <section className="card" aria-labelledby="model-heading">
      <h2 id="model-heading">{t('model.section')}</h2>
      <p className="intro">{t('model.intro')}</p>
      {list.loadError !== null ? (
        <p role="alert" className="notice">
          {t('settings.loadFailed', { detail: list.loadError })}
        </p>
      ) : view === null ? (
        <p>{t('settings.loading')}</p>
      ) : (
        <EditableList
          kind="model"
          view={view}
          change={change}
          busy={busy}
          calls={calls}
          nameOf={displayName}
          details={(config) => {
            const origin = new URL(config.baseURL).origin;
            return (
              <>
                <span>
                  {config.model} · {origin}
                </span>
                {missing(config) ? (
                  <span className="hint">{t('model.access.missingHint', { origin })}</span>
                ) : null}
              </>
            );
          }}
          badges={(config) =>
            missing(config) ? <span className="badge warn">{t('model.access.missing')}</span> : null
          }
          actions={(config) =>
            missing(config) ? (
              <button
                type="button"
                className="secondary"
                aria-label={t('model.access.grant.label', { name: displayName(config) })}
                // The prompt needs the click's user gesture: nothing may await before it.
                onClick={() => void requestOriginAccess(config.baseURL)}
              >
                {t('model.access.grant')}
              </button>
            ) : null
          }
          editor={(config, { focusOnOpen, close, cancel }) => (
            <ModelForm
              key={config?.id ?? 'new'}
              heading={
                config
                  ? t('model.editHeading', { name: displayName(config) })
                  : t('model.addHeading')
              }
              initial={config}
              saving={busy}
              readOnly={view.readOnly}
              focusOnOpen={focusOnOpen}
              // The permission prompt is already showing; the row's badge
              // follows whatever the user answers.
              onSave={(form) =>
                void change(
                  () =>
                    config === null
                      ? callRpc('models.add', form)
                      : callRpc('models.update', {
                          id: config.id,
                          patch: changedFields(config, form),
                        }),
                  () => t('list.saved'),
                ).then((saved) => saved && close())
              }
              onCancel={cancel}
            />
          )}
        />
      )}
      <p role="status" className="save-status">
        {describeStatus(list.status)}
      </p>
    </section>
  );
}
