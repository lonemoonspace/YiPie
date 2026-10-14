import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { t } from '@/domain/i18n';
import {
  EMPTY_MODEL_FORM,
  formFromConfig,
  parseModelForm,
  type ModelFormErrors,
  type ModelFormFields,
} from '@/domain/model-form';
import { requestOriginAccess } from '@/platform/permissions/origin-access';
import { useModelConfig, type ModelConfigState } from './use-model-config';

/** The single model configuration phase 1 edits (docs/development-plan.md §4.2). */
export function ModelSection() {
  const state = useModelConfig();

  return (
    <section className="card" aria-labelledby="model-heading">
      <h2 id="model-heading">{t('model.section')}</h2>
      <p className="intro">{t('model.intro')}</p>
      {state.loadError !== null ? (
        <p role="alert" className="notice">
          {t('settings.loadFailed', { detail: state.loadError })}
        </p>
      ) : state.view === null ? (
        <p>{t('settings.loading')}</p>
      ) : (
        // A new key after each successful save remounts the form with what was
        // stored (normalized URL, trimmed text); a failed save keeps the input.
        <ModelForm key={state.revision} state={state} />
      )}
    </section>
  );
}

function ModelForm({ state }: { state: ModelConfigState }) {
  const { current, view, save, access, submit } = state;
  const [fields, setFields] = useState<ModelFormFields>(() =>
    current ? formFromConfig(current) : EMPTY_MODEL_FORM,
  );
  const [errors, setErrors] = useState<ModelFormErrors>({});

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
    // Still inside the submit event: Chrome only shows the prompt during a
    // user gesture, so this must run before anything awaits.
    const accessRequest = requestOriginAccess(parsed.value.baseURL);
    void submit(parsed.value, accessRequest);
  };

  const readOnly = view?.readOnly ?? false;
  const saving = save.kind === 'saving';
  const savedOrigin = current ? new URL(current.baseURL).origin : null;

  return (
    <form onSubmit={onSubmit} noValidate>
      {readOnly ? (
        <p role="alert" className="notice">
          {t('settings.readOnly')}
        </p>
      ) : view?.status === 'invalid' ? (
        <p role="alert" className="notice">
          {t('settings.invalid')}
        </p>
      ) : null}

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
          multiline
        />
        <TextField
          label={t('model.extraBody')}
          hint={t('model.extraBody.hint')}
          error={errors.extraBody}
          value={fields.extraBody}
          onChange={(value) => set('extraBody', value)}
          multiline
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
            id="model-stream-usage"
            type="checkbox"
            checked={fields.streamUsage}
            onChange={(event) => set('streamUsage', event.target.checked)}
          />
          <label htmlFor="model-stream-usage">{t('model.streamUsage')}</label>
        </div>
      </details>

      <div className="actions">
        <button type="submit" disabled={readOnly || saving}>
          {saving ? t('model.saving') : t('model.save')}
        </button>
        <p role="status" className="save-status">
          {describeSave(save)}
        </p>
      </div>
      {savedOrigin !== null && access !== 'unknown' ? (
        <p className={access === 'granted' ? 'hint' : 'notice'}>
          {access === 'granted'
            ? t('model.permission.granted', { origin: savedOrigin })
            : t('model.permission.missing', { origin: savedOrigin })}
        </p>
      ) : null}
    </form>
  );
}

function describeSave(save: ModelConfigState['save']) {
  switch (save.kind) {
    case 'idle':
      return '';
    case 'saving':
      return t('model.saving');
    case 'saved':
      return t('model.saved');
    case 'failed':
      return t('model.saveFailed', { detail: save.message });
  }
}

interface TextFieldProps {
  label: string;
  hint: string;
  error: string | undefined;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'password';
  inputMode?: 'url' | 'numeric';
  multiline?: boolean;
  required?: boolean;
}

function TextField(props: TextFieldProps): ReactNode {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = props.error ? `${errorId} ${hintId}` : hintId;
  const common = {
    id,
    value: props.value,
    'aria-describedby': describedBy,
    'aria-invalid': props.error ? true : undefined,
    'aria-required': props.required ? true : undefined,
    spellCheck: false,
    autoComplete: 'off',
  } as const;

  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      {props.multiline ? (
        <textarea {...common} rows={3} onChange={(event) => props.onChange(event.target.value)} />
      ) : (
        <input
          {...common}
          type={props.type ?? 'text'}
          inputMode={props.inputMode}
          onChange={(event) => props.onChange(event.target.value)}
        />
      )}
      {props.error ? (
        <p id={errorId} className="error">
          {props.error}
        </p>
      ) : null}
      <p id={hintId} className="hint">
        {props.hint}
      </p>
    </div>
  );
}
