import { useId, type ReactNode } from 'react';

export interface TextFieldProps {
  label: string;
  hint?: string;
  error?: string | undefined;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'password';
  inputMode?: 'url' | 'numeric';
  /** A textarea of this many rows instead of a one-line input. */
  rows?: number;
  required?: boolean;
  /** Extra notes under the hint, such as warnings that do not block saving. */
  children?: ReactNode;
}

/** A labelled input with its hint and error, wired up for screen readers. */
export function TextField(props: TextFieldProps): ReactNode {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [props.error ? errorId : null, props.hint ? hintId : null]
    .filter((part) => part !== null)
    .join(' ');
  const common = {
    id,
    value: props.value,
    'aria-describedby': describedBy || undefined,
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
      {props.hint ? (
        <p id={hintId} className="hint">
          {props.hint}
        </p>
      ) : null}
      {props.children}
    </div>
  );
}
