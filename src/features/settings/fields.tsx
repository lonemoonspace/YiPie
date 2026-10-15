import { useId, type ReactNode } from 'react';

interface TextFieldProps {
  label: string;
  hint: string;
  error: string | undefined;
  /** Shown under the field without blocking a save. */
  warnings?: readonly string[];
  /** Like warnings, but marked in red: worth fixing, though they do not block a save either. */
  flags?: readonly string[];
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'password';
  inputMode?: 'url' | 'numeric';
  /** Rows of a multi-line field; a single-line input without it. */
  rows?: number;
  required?: boolean;
}

/** A labelled input with its hint, error and warnings, all tied to it for screen readers. */
export function TextField(props: TextFieldProps): ReactNode {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const warningId = `${id}-warning`;
  const flagId = `${id}-flag`;
  const warnings = props.warnings ?? [];
  const flags = props.flags ?? [];
  const describedBy = [
    props.error ? errorId : null,
    flags.length > 0 ? flagId : null,
    warnings.length > 0 ? warningId : null,
    hintId,
  ]
    .filter((part) => part !== null)
    .join(' ');
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
      {props.rows !== undefined ? (
        <textarea
          {...common}
          rows={props.rows}
          onChange={(event) => props.onChange(event.target.value)}
        />
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
      {flags.length > 0 ? (
        <div id={flagId} className="warning flagged">
          {flags.map((flag) => (
            <p key={flag}>{flag}</p>
          ))}
        </div>
      ) : null}
      {warnings.length > 0 ? (
        <div id={warningId} className="warning">
          {warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}
      <p id={hintId} className="hint">
        {props.hint}
      </p>
    </div>
  );
}
