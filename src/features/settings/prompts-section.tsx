import { useState, type FormEvent, type ReactNode } from 'react';
import type { PromptConfig } from '@/contract/prompt-config';
import type { PromptConfigsChange, PromptConfigsView } from '@/contract/rpc';
import { t } from '@/domain/i18n';
import { BUILT_IN_PROMPT } from '@/domain/prompt/default-prompt';
import {
  EMPTY_PROMPT_FORM,
  formFromPrompt,
  parsePromptForm,
  promptWarnings,
  type PromptFormErrors,
  type PromptFormFields,
} from '@/domain/prompt-form';
import { callRpc } from '@/platform/rpc/client';
import { TextField } from './fields';
import { ListRows } from './list-rows';
import { useList, type ListApi, type ListNotice } from './use-list';

const promptsApi: ListApi<PromptConfig, PromptConfigsView, PromptConfigsChange, PromptFormFields> =
  {
    load: () => callRpc('prompts.list', {}),
    add: (form) => callRpc('prompts.add', form),
    update: (id, form) => callRpc('prompts.update', { id, patch: form }),
    remove: (id) => callRpc('prompts.remove', { id }),
    move: (id, to) => callRpc('prompts.move', { id, to }),
    setDefault: (id) => callRpc('prompts.setDefault', { id }),
  };

/**
 * The prompt list. Prompts are changed here only, never from the panel, so a
 * stray click there cannot change what every summary uses
 * (docs/development-plan.md §4.3, decision 7).
 */
export function PromptsSection({ onBackedUp }: { onBackedUp?: () => void }) {
  const list = useList(promptsApi, onBackedUp);
  const { view, editing, busy } = list;
  const readOnly = view?.readOnly ?? false;

  const form = (initial: PromptConfig | null) => (
    <PromptForm
      key={initial?.id ?? 'new'}
      heading={initial === null ? t('prompt.adding') : t('prompt.editing', { name: initial.name })}
      initial={initial}
      busy={busy}
      readOnly={readOnly}
      onSubmit={(fields) => void list.save(fields)}
      onCancel={list.stopEditing}
    />
  );

  return (
    <section className="card" aria-labelledby="prompt-heading">
      <h2 id="prompt-heading">{t('prompt.section')}</h2>
      <p className="intro">{t('prompt.intro')}</p>
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
            <p className="hint">{t('prompt.empty')}</p>
          ) : (
            <ListRows<PromptConfig>
              items={view.items}
              defaultId={view.defaultId}
              disabled={busy || readOnly}
              name={(prompt) => prompt.name}
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
                {t('prompt.add')}
              </button>
              <button
                type="button"
                className="quiet"
                disabled={busy || readOnly}
                onClick={() => void list.add({ ...BUILT_IN_PROMPT })}
              >
                {t('prompt.addBuiltIn')}
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

function describe(notice: ListNotice<PromptConfigsChange> | null): string {
  if (notice === null) return '';
  switch (notice.kind) {
    case 'saved':
      return notice.quarantined ? t('settings.savedQuarantined') : t('settings.saved');
    case 'failed':
      return t('list.failed', { detail: notice.message });
    case 'removed': {
      const { fallback } = notice.change;
      if (fallback === null) return t('list.removed');
      return fallback.to === null
        ? t('prompt.fallbackEmpty', { from: fallback.from.name })
        : t('prompt.fallback', { from: fallback.from.name, to: fallback.to.name });
    }
  }
}

interface PromptFormProps {
  heading: string;
  initial: PromptConfig | null;
  busy: boolean;
  readOnly: boolean;
  onSubmit: (fields: PromptFormFields) => void;
  onCancel: () => void;
}

function PromptForm(props: PromptFormProps): ReactNode {
  const [fields, setFields] = useState<PromptFormFields>(() =>
    props.initial ? formFromPrompt(props.initial) : EMPTY_PROMPT_FORM,
  );
  const [errors, setErrors] = useState<PromptFormErrors>({});
  const warnings = promptWarnings(fields);

  const set = (name: keyof PromptFormFields, value: string) =>
    setFields((previous) => ({ ...previous, [name]: value }));

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = parsePromptForm(fields);
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
        label={t('prompt.name')}
        error={errors.name}
        value={fields.name}
        onChange={(value) => set('name', value)}
        required
      />
      <TextField
        label={t('prompt.system')}
        hint={t('prompt.system.hint')}
        value={fields.system}
        onChange={(value) => set('system', value)}
        rows={6}
      />
      <TextField
        label={t('prompt.user')}
        hint={t('prompt.user.hint')}
        error={errors.user}
        value={fields.user}
        onChange={(value) => set('user', value)}
        rows={8}
        required
      />
      <p className="hint">{t('prompt.variables')}</p>
      {warnings.unknown.length > 0 ? (
        <p className="warning">
          {t('prompt.unknown', {
            list: warnings.unknown.map((name) => `{{${name}}}`).join('、'),
          })}
        </p>
      ) : null}
      {warnings.noContent ? <p className="warning">{t('prompt.noContent')}</p> : null}

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
