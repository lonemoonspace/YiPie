import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { displayName, type ModelConfig } from '@/contract/model-config';
import type { ModelConfigsChange, ModelConfigsView } from '@/contract/rpc';
import { t } from '@/domain/i18n';
import {
  EMPTY_MODEL_FORM,
  formFromConfig,
  parseModelForm,
  type ModelFormErrors,
  type ModelFormFields,
  type ParsedModelForm,
} from '@/domain/model-form';
import { requestOriginAccess } from '@/platform/permissions/origin-access';
import { callRpc } from '@/platform/rpc/client';
import { TextField } from './fields';
import { ListRows } from './list-rows';
import { useList, type ListApi, type ListNotice } from './use-list';
import { useOriginAccess } from './use-origin-access';

const modelsApi: ListApi<ModelConfig, ModelConfigsView, ModelConfigsChange, ParsedModelForm> = {
  load: () => callRpc('models.list', {}),
  add: (form) => callRpc('models.add', form),
  update: (id, form) => callRpc('models.update', { id, patch: form }),
  remove: (id) => callRpc('models.remove', { id }),
  move: (id, to) => callRpc('models.move', { id, to }),
  setDefault: (id) => callRpc('models.setDefault', { id }),
};

/** The model list (docs/development-plan.md §4.3). */
export function ModelsSection({ onBackedUp }: { onBackedUp?: () => void }) {
  const list = useList(modelsApi, onBackedUp);
  const { view, editing, busy } = list;
  const [accessRevision, setAccessRevision] = useState(0);
  const access = useOriginAccess(view?.items.map((config) => config.baseURL) ?? [], accessRevision);

  const submit = (form: ParsedModelForm) => {
    // Still inside the submit event: Chrome only shows the prompt during a
    // user gesture, so this must run before anything awaits.
    const asked = requestOriginAccess(form.baseURL);
    void list
      .save(form)
      .then(() => asked)
      .finally(() => setAccessRevision((count) => count + 1));
  };

  const readOnly = view?.readOnly ?? false;
  const form = (initial: ModelConfig | null) => (
    <ModelForm
      key={initial?.id ?? 'new'}
      heading={
        initial === null ? t('model.adding') : t('model.editing', { name: displayName(initial) })
      }
      initial={initial}
      busy={busy}
      readOnly={readOnly}
      onSubmit={submit}
      onCancel={list.stopEditing}
    />
  );

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
        <>
          {view.readOnly ? (
            <p role="alert" className="notice">
              {t('settings.readOnly')}
            </p>
          ) : view.status === 'invalid' ? (
            <p role="alert" className="notice">
              {t('list.invalid')}
            </p>
          ) : null}

          {view.items.length === 0 ? (
            <p className="hint">{t('model.empty')}</p>
          ) : (
            <ListRows<ModelConfig>
              items={view.items}
              defaultId={view.defaultId}
              disabled={busy || readOnly}
              name={displayName}
              detail={(config) => {
                const origin = new URL(config.baseURL).origin;
                return (
                  <>
                    {config.model} · {origin}
                    {access.get(origin) === false ? (
                      <span className="tag" title={t('model.permission.missing', { origin })}>
                        {t('model.noAccess')}
                      </span>
                    ) : null}
                  </>
                );
              }}
              editingId={editing?.mode === 'edit' ? editing.id : null}
              editor={form}
              onSetDefault={(id) => void list.setDefault(id)}
              onMove={(id, by) => void list.move(id, by)}
              onEdit={list.startEditing}
              onRemove={(id) => void list.remove(id)}
            />
          )}

          {editing?.mode === 'add' ? (
            form(null)
          ) : (
            <div className="actions">
              <button type="button" disabled={busy || readOnly} onClick={list.startAdding}>
                {t('model.add')}
              </button>
            </div>
          )}
          <p role="status" className="save-status">
            {describe(list.notice)}
          </p>
        </>
      )}
    </section>
  );
}

function describe(notice: ListNotice<ModelConfigsChange> | null): string {
  if (notice === null) return '';
  switch (notice.kind) {
    case 'saved':
      return notice.quarantined ? t('settings.savedQuarantined') : t('settings.saved');
    case 'failed':
      return t('list.failed', { detail: notice.message });
    case 'removed': {
      const { fallback, released } = notice.change;
      const parts = [
        fallback === null
          ? t('list.removed')
          : fallback.to === null
            ? t('model.fallbackEmpty', { from: fallback.from.name })
            : t('model.fallback', { from: fallback.from.name, to: fallback.to.name }),
      ];
      if (released.length > 0) {
        const origins = released.map((pattern) => pattern.replace(/\/\*$/, '')).join('、');
        parts.push(t('model.released', { origins }));
      }
      return parts.join(' ');
    }
  }
}

interface ModelFormProps {
  heading: string;
  initial: ModelConfig | null;
  busy: boolean;
  readOnly: boolean;
  onSubmit: (form: ParsedModelForm) => void;
  onCancel: () => void;
}

function ModelForm(props: ModelFormProps): ReactNode {
  const [fields, setFields] = useState<ModelFormFields>(() =>
    props.initial ? formFromConfig(props.initial) : EMPTY_MODEL_FORM,
  );
  const [errors, setErrors] = useState<ModelFormErrors>({});
  const usageId = useId();

  const set = <K extends keyof ModelFormFields>(name: K, value: ModelFormFields[K]) =>
    setFields((previous) => ({ ...previous, [name]: value }));

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = parseModelForm(fields);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    props.onSubmit(parsed.value);
  };

  return (
    <form className="editor" onSubmit={onSubmit} noValidate aria-label={props.heading}>
      <h3>{props.heading}</h3>
      <TextField
        label={t('model.baseURL')}
        hint={t('model.baseURL.hint')}
        error={errors.baseURL}
        value={fields.baseURL}
        onChange={(value) => set('baseURL', value)}
        inputMode="url"
        required
      />
      <TextField
        label={t('model.apiKey')}
        hint={t('model.apiKey.hint')}
        error={errors.apiKey}
        value={fields.apiKey}
        onChange={(value) => set('apiKey', value)}
        type="password"
      />
      <TextField
        label={t('model.model')}
        hint={t('model.model.hint')}
        error={errors.model}
        value={fields.model}
        onChange={(value) => set('model', value)}
        required
      />
      <TextField
        label={t('model.name')}
        hint={t('model.name.hint')}
        error={errors.name}
        value={fields.name}
        onChange={(value) => set('name', value)}
      />

      <details className="advanced">
        <summary>{t('model.advanced')}</summary>
        <TextField
          label={t('model.headers')}
          hint={t('model.headers.hint')}
          error={errors.headers}
          value={fields.headers}
          onChange={(value) => set('headers', value)}
          rows={3}
        />
        <TextField
          label={t('model.extraBody')}
          hint={t('model.extraBody.hint')}
          error={errors.extraBody}
          value={fields.extraBody}
          onChange={(value) => set('extraBody', value)}
          rows={3}
        />
        <TextField
          label={t('model.contextWindow')}
          hint={t('model.contextWindow.hint')}
          error={errors.contextWindow}
          value={fields.contextWindow}
          onChange={(value) => set('contextWindow', value)}
          inputMode="numeric"
        />
        <div className="field checkbox">
          <input
            id={usageId}
            type="checkbox"
            checked={fields.streamUsage}
            onChange={(event) => set('streamUsage', event.target.checked)}
          />
          <label htmlFor={usageId}>{t('model.streamUsage')}</label>
        </div>
      </details>

      <div className="actions">
        <button type="submit" disabled={props.readOnly || props.busy}>
          {props.busy ? t('form.saving') : t('form.save')}
        </button>
        <button type="button" className="quiet" onClick={props.onCancel}>
          {t('form.cancel')}
        </button>
      </div>
    </form>
  );
}
