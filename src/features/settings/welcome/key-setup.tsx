import { useEffect, useId, useRef, useState } from 'react';
import { t } from '@/domain/i18n';
import type { LlmError } from '@/domain/llm/errors';
import { EMPTY_MODEL_FORM, modelOptions, parseModelForm } from '@/domain/model-form';
import { pickModel, type StartService } from '@/domain/onboarding';
import { describeFailure } from '../connection-test';
import { TextField } from '../fields';
import { listModels, streamChat } from '@/platform/llm/client';
import { requestOriginAccess } from '@/platform/permissions/origin-access';
import { saveFirstModel } from './save-model';

type Listing =
  | { kind: 'idle' }
  | { kind: 'fetching' }
  | { kind: 'listed'; models: string[] }
  | { kind: 'unsupported' }
  | { kind: 'failed'; error: LlmError; origin: string };

type Saving =
  | { kind: 'idle' }
  | { kind: 'testing' }
  /** The test request failed: the user may save anyway. */
  | { kind: 'test-failed'; error: LlmError; origin: string }
  | { kind: 'saving' }
  | { kind: 'save-failed'; detail: string };

/** Entered by hand rather than picked from `services`. */
const CUSTOM = 'custom';

interface KeySetupProps {
  services: readonly StartService[];
  /** The free path: no address of one's own, and a note on each service. */
  free?: boolean;
  /** A line under each service's name. */
  note?: (service: StartService) => string;
  onDone: (name: string) => void;
}

/**
 * The quickest way to a working model (docs/development-plan.md §4.8): pick
 * a service, paste a key, and the service's model list is fetched with a
 * model chosen from it. One real request, a few tokens, checks the whole
 * setup before it is saved. Host access is asked for inside each click, as
 * the settings page does.
 */
export function KeySetup({ services, free = false, note, onDone }: KeySetupProps) {
  const [serviceId, setServiceId] = useState<string>(services[0]?.id ?? CUSTOM);
  const [customURL, setCustomURL] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [errors, setErrors] = useState<{ baseURL?: string; model?: string }>({});
  const [listing, setListing] = useState<Listing>({ kind: 'idle' });
  const [saving, setSaving] = useState<Saving>({ kind: 'idle' });
  const run = useRef<AbortController | null>(null);
  const groupId = useId();

  useEffect(() => () => run.current?.abort(), []);

  const service = services.find((candidate) => candidate.id === serviceId) ?? null;

  /** A new service or key: what was fetched or tested belongs to the old one. */
  const reset = () => {
    run.current?.abort();
    setListing({ kind: 'idle' });
    setSaving({ kind: 'idle' });
    setModel('');
  };

  const begin = () => {
    run.current?.abort();
    const controller = new AbortController();
    run.current = controller;
    return controller;
  };

  /** The form as it is now, checked; null with the errors shown. */
  const parsed = (withModel: boolean) => {
    const result = parseModelForm({
      ...EMPTY_MODEL_FORM,
      name: service?.name ?? '',
      baseURL: service?.baseURL ?? customURL,
      apiKey,
      // The connection alone is checked before a model is chosen.
      model: withModel ? model : 'placeholder',
    });
    if (!result.ok) {
      setErrors({ baseURL: result.errors.baseURL, model: result.errors.model });
      return null;
    }
    setErrors({});
    return result.value;
  };

  const connect = () => {
    const form = parsed(false);
    if (form === null) return;
    // Still inside the click: the browser shows the prompt only during a gesture.
    const access = requestOriginAccess(form.baseURL);
    const controller = begin();
    setListing({ kind: 'fetching' });
    setSaving({ kind: 'idle' });
    void (async () => {
      await access.catch(() => false);
      const outcome = await listModels({ config: form, signal: controller.signal });
      if (controller.signal.aborted) return;
      switch (outcome.kind) {
        case 'listed': {
          // Shown in alphabetical order; picked in the service's own.
          setListing({ kind: 'listed', models: modelOptions(outcome.models) });
          setModel(pickModel(outcome.models, service) ?? '');
          return;
        }
        case 'unsupported':
          setListing({ kind: 'unsupported' });
          setModel(service?.models[0] ?? '');
          return;
        case 'error':
          setListing({
            kind: 'failed',
            error: outcome.error,
            origin: new URL(form.baseURL).origin,
          });
      }
    })();
  };

  const save = (form: NonNullable<ReturnType<typeof parsed>>) => {
    setSaving({ kind: 'saving' });
    saveFirstModel(form).then(onDone, (error: unknown) =>
      setSaving({
        kind: 'save-failed',
        detail: error instanceof Error ? error.message : String(error),
      }),
    );
  };

  const testAndSave = () => {
    const form = parsed(true);
    if (form === null) return;
    const access = requestOriginAccess(form.baseURL);
    const controller = begin();
    const stop = new AbortController();
    controller.signal.addEventListener('abort', () => stop.abort(), { once: true });
    let answered = false;
    setSaving({ kind: 'testing' });
    void (async () => {
      await access.catch(() => false);
      if (controller.signal.aborted) return;
      const outcome = await streamChat({
        config: form,
        messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
        signal: stop.signal,
        // The first word is proof enough: stop there and spend no more.
        onText: () => {
          answered = true;
          stop.abort();
        },
      });
      if (controller.signal.aborted) return;
      if (answered || outcome.kind === 'done') save(form);
      else if (outcome.kind === 'error') {
        setSaving({
          kind: 'test-failed',
          error: outcome.error,
          origin: new URL(form.baseURL).origin,
        });
      } else setSaving({ kind: 'idle' });
    })();
  };

  const connected = listing.kind === 'listed' || listing.kind === 'unsupported';
  const listed = listing.kind === 'listed' && listing.models.length > 0 ? listing.models : null;
  const busy = listing.kind === 'fetching' || saving.kind === 'testing' || saving.kind === 'saving';

  return (
    <div className="setup" data-path={free ? 'free' : 'key'}>
      <fieldset className="services">
        <legend id={groupId}>{t(free ? 'welcome.free.pick' : 'welcome.key.pick')}</legend>
        {[...services, ...(free ? [] : [null])].map((option) => {
          const id = option?.id ?? CUSTOM;
          return (
            <label key={id} className="service" data-checked={id === serviceId}>
              <input
                type="radio"
                name={groupId}
                value={id}
                checked={id === serviceId}
                onChange={() => {
                  setServiceId(id);
                  reset();
                }}
              />
              <span className="service-name">{option?.name ?? t('welcome.key.custom')}</span>
              {note !== undefined && option !== null ? (
                <span className="hint">{note(option)}</span>
              ) : null}
            </label>
          );
        })}
      </fieldset>
      {free ? <p className="hint">{t('welcome.free.disclaimer')}</p> : null}

      {service === null ? (
        <TextField
          label={t('model.baseURL')}
          hint={t('model.baseURL.hint')}
          error={errors.baseURL}
          value={customURL}
          onChange={(value) => {
            setCustomURL(value);
            reset();
          }}
          inputMode="url"
          required
        />
      ) : (
        <p className="key-link">
          <a href={service.keyURL} target="_blank" rel="noopener noreferrer">
            {t('welcome.key.get', { name: service.name })}
          </a>
        </p>
      )}

      <TextField
        label={t('model.apiKey')}
        hint={t('welcome.key.hint')}
        error={undefined}
        value={apiKey}
        onChange={(value) => {
          setApiKey(value);
          reset();
        }}
        type="password"
      />

      <div className="actions">
        <button type="button" disabled={busy} onClick={connect}>
          {listing.kind === 'fetching' ? t('welcome.key.connecting') : t('welcome.key.connect')}
        </button>
      </div>
      <p aria-live="polite" className="setup-result hint" data-result={listing.kind}>
        {describeListing(listing)}
      </p>

      {connected ? (
        <div className="setup-model">
          {listed !== null ? (
            <div className="field">
              <label htmlFor={`${groupId}-model`}>{t('welcome.key.model')}</label>
              <select
                id={`${groupId}-model`}
                value={model}
                onChange={(event) => {
                  setModel(event.target.value);
                  setSaving({ kind: 'idle' });
                }}
              >
                {model === '' ? (
                  <option value="" disabled>
                    {t('model.fetch.choose', { count: listed.length })}
                  </option>
                ) : null}
                {listed.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <p className="hint">{t('welcome.key.modelHint')}</p>
            </div>
          ) : (
            <TextField
              label={t('model.model')}
              hint={t('model.model.hint')}
              error={errors.model}
              value={model}
              onChange={(value) => {
                setModel(value);
                setSaving({ kind: 'idle' });
              }}
              required
            />
          )}
          <div className="actions">
            <button type="button" disabled={busy || model.trim() === ''} onClick={testAndSave}>
              {saving.kind === 'testing'
                ? t('model.test.testing')
                : saving.kind === 'saving'
                  ? t('model.saving')
                  : t('welcome.key.save')}
            </button>
          </div>
          <div aria-live="polite" className="setup-result" data-result={saving.kind}>
            {saving.kind === 'test-failed' ? (
              <>
                <p>{`${t('model.test.failed')}${describeFailure(saving.error, saving.origin)}`}</p>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    const form = parsed(true);
                    if (form !== null) save(form);
                  }}
                >
                  {t('welcome.key.saveAnyway')}
                </button>
              </>
            ) : saving.kind === 'save-failed' ? (
              <p role="alert">{t('settings.saveFailed', { detail: saving.detail })}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function describeListing(listing: Listing): string {
  switch (listing.kind) {
    case 'idle':
    case 'fetching':
      return '';
    case 'listed':
      return listing.models.length === 0
        ? t('welcome.key.emptyList')
        : t('welcome.key.listed', { count: listing.models.length });
    case 'unsupported':
      return t('welcome.key.unsupported');
    case 'failed':
      return `${t('model.test.failed')}${describeFailure(listing.error, listing.origin)}`;
  }
}
