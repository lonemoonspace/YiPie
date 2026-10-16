import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { ModelConfig } from '@/contract/model-config';
import { BASE_URL_PRESETS } from '@/domain/base-url-presets';
import { DEFAULT_CONTEXT_WINDOW } from '@/domain/budget';
import { t } from '@/domain/i18n';
import {
  EMPTY_MODEL_FORM,
  formFromConfig,
  parseConnectionFields,
  parseModelForm,
  type ModelFormErrors,
  type ModelFormFields,
  type ParsedModelForm,
} from '@/domain/model-form';
import { requestOriginAccess } from '@/platform/permissions/origin-access';
import { ConnectionTest } from './connection-test';
import { TextField } from './fields';
import { ModelFetch } from './model-fetch';

interface ModelFormProps {
  heading: string;
  /** The configuration being edited; null for a new one. */
  initial: ModelConfig | null;
  saving: boolean;
  readOnly: boolean;
  /** Moves focus into the form when it opens; not on page load. */
  focusOnOpen: boolean;
  /**
   * Called with the checked form and the permission prompt, which has to
   * start inside the submit event, before anything awaits.
   */
  onSave: (form: ParsedModelForm, accessRequest: Promise<boolean>) => void;
  /** Absent when there is nothing to go back to (the list is empty). */
  onCancel?: () => void;
}

/** Adds or edits one model configuration. */
export function ModelForm(props: ModelFormProps) {
  const { initial } = props;
  const [fields, setFields] = useState<ModelFormFields>(() =>
    initial ? formFromConfig(initial) : EMPTY_MODEL_FORM,
  );
  const [errors, setErrors] = useState<ModelFormErrors>({});
  const headingId = useId();
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (props.focusOnOpen) form.current?.querySelector('input')?.focus();
  }, [props.focusOnOpen]);

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
    props.onSave(parsed.value, accessRequest);
  };

  return (
    <form ref={form} className="editor" onSubmit={onSubmit} noValidate aria-labelledby={headingId}>
      <h3 id={headingId}>{props.heading}</h3>
      <TextField
        label={t('model.baseURL')}
        hint={t('model.baseURL.hint')}
        error={errors.baseURL}
        value={fields.baseURL}
        onChange={(value) => set('baseURL', value)}
        inputMode="url"
        required
      />
      <div className="presets" role="group" aria-label={t('model.presets')}>
        <span className="hint">{t('model.presets')}</span>
        {BASE_URL_PRESETS.map((preset) => (
          <button
            key={preset.name}
            type="button"
            className="chip"
            title={preset.baseURL}
            aria-label={t('model.presets.fill', { name: preset.name })}
            onClick={() => set('baseURL', preset.baseURL)}
          >
            {preset.name}
          </button>
        ))}
      </div>
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
      <ModelFetch
        model={fields.model}
        onPick={(model) => set('model', model)}
        check={() => {
          const parsed = parseConnectionFields(fields);
          setErrors(parsed.ok ? {} : parsed.errors);
          return parsed.ok ? parsed.value : null;
        }}
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
          hint={t('model.contextWindow.hint', {
            window: DEFAULT_CONTEXT_WINDOW.toLocaleString('en-US'),
          })}
          error={errors.contextWindow}
          value={fields.contextWindow}
          onChange={(value) => set('contextWindow', value)}
          inputMode="numeric"
        />
        <div className="field checkbox">
          <input
            id={`${headingId}-stream-usage`}
            type="checkbox"
            checked={fields.streamUsage}
            onChange={(event) => set('streamUsage', event.target.checked)}
            aria-describedby={`${headingId}-stream-usage-hint`}
          />
          <label htmlFor={`${headingId}-stream-usage`}>{t('model.streamUsage')}</label>
          <p id={`${headingId}-stream-usage-hint`} className="hint">
            {t('model.streamUsage.hint')}
          </p>
        </div>
      </details>

      <ConnectionTest
        check={() => {
          const parsed = parseModelForm(fields);
          setErrors(parsed.ok ? {} : parsed.errors);
          return parsed.ok ? parsed.value : null;
        }}
      />

      <div className="actions">
        <button type="submit" disabled={props.readOnly || props.saving}>
          {props.saving ? t('model.saving') : t('model.save')}
        </button>
        {props.onCancel ? (
          <button type="button" className="secondary" onClick={props.onCancel}>
            {t('list.cancel')}
          </button>
        ) : null}
      </div>
    </form>
  );
}
