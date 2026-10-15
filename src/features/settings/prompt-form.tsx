import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { PromptConfig } from '@/contract/prompt-config';
import { t } from '@/domain/i18n';
import {
  formFromPrompt,
  newPromptForm,
  parsePromptForm,
  previewPrompt,
  promptFormWarnings,
  unknownVariableFlags,
  variableHints,
  type PromptFormErrors,
  type PromptFormFields,
} from '@/domain/prompt-form';
import { TextField } from './fields';

interface PromptFormProps {
  heading: string;
  /** The prompt being edited; null for a new one, which starts from the built-in templates. */
  initial: PromptConfig | null;
  saving: boolean;
  readOnly: boolean;
  /** Moves focus into the form when it opens; not on page load. */
  focusOnOpen: boolean;
  onSave: (form: PromptFormFields) => void;
  /** Absent when there is nothing to go back to (the list is empty). */
  onCancel?: () => void;
}

/**
 * Adds or edits one prompt. Unknown placeholders and a pair of templates that
 * never sends the page are pointed out as the user types; neither blocks a
 * save (docs/development-plan.md §4.3, decision 3).
 */
export function PromptForm(props: PromptFormProps) {
  const { initial } = props;
  const [fields, setFields] = useState<PromptFormFields>(() =>
    initial ? formFromPrompt(initial) : newPromptForm(),
  );
  const [errors, setErrors] = useState<PromptFormErrors>({});
  const warnings = promptFormWarnings(fields);
  const flags = unknownVariableFlags(fields);
  const headingId = useId();
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (props.focusOnOpen) form.current?.querySelector('input')?.focus();
  }, [props.focusOnOpen]);

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
    props.onSave(parsed.value);
  };

  return (
    <form ref={form} className="editor" onSubmit={onSubmit} noValidate aria-labelledby={headingId}>
      <h3 id={headingId}>{props.heading}</h3>
      <TextField
        label={t('prompt.name')}
        hint={t('prompt.name.hint')}
        error={errors.name}
        value={fields.name}
        onChange={(value) => set('name', value)}
        required
      />
      <TextField
        label={t('prompt.system')}
        hint={t('prompt.system.hint')}
        error={errors.system}
        warnings={warnings.system}
        flags={flags.system}
        value={fields.system}
        onChange={(value) => set('system', value)}
        rows={8}
      />
      <TextField
        label={t('prompt.user')}
        hint={t('prompt.user.hint')}
        error={errors.user}
        warnings={warnings.user}
        flags={flags.user}
        value={fields.user}
        onChange={(value) => set('user', value)}
        rows={6}
        required
      />
      <details className="advanced">
        <summary>{t('prompt.variables')}</summary>
        <dl className="variables">
          {variableHints().map(({ placeholder, meaning }) => (
            <div key={placeholder}>
              <dt>
                <code>{placeholder}</code>
              </dt>
              <dd>{meaning}</dd>
            </div>
          ))}
        </dl>
      </details>
      <PromptPreview fields={fields} />

      <div className="actions">
        <button type="submit" disabled={props.readOnly || props.saving}>
          {props.saving ? t('prompt.saving') : t('prompt.save')}
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

/** The templates rendered for a sample page, as the model would get them. */
function PromptPreview({ fields }: { fields: PromptFormFields }) {
  const [open, setOpen] = useState(false);
  const preview = open ? previewPrompt(fields) : null;
  return (
    <details className="advanced" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{t('prompt.preview')}</summary>
      {preview !== null ? (
        <>
          <h4 className="hint">{t('prompt.preview.system')}</h4>
          <pre className="backup-preview">
            {preview.system.trim() === '' ? t('prompt.preview.noSystem') : preview.system}
          </pre>
          <h4 className="hint">{t('prompt.preview.user')}</h4>
          <pre className="backup-preview">{preview.user}</pre>
        </>
      ) : null}
    </details>
  );
}
