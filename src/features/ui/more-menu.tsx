import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { MoreIcon } from './icons';

interface MoreMenuProps {
  /** Names the button, e.g. "More" or "More for 「name」". */
  label: string;
  /** The actions, as buttons; each calls `close` once it has run. */
  children: (close: () => void) => ReactNode;
}

/**
 * A "⋯" button that shows a few less-used actions below it. A disclosure
 * rather than an ARIA menu: the actions are ordinary buttons, reached with
 * Tab. Escape or a press elsewhere closes it; Escape gives focus back to the
 * button.
 */
export function MoreMenu({ label, children }: MoreMenuProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !root.current?.contains(event.target)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      close();
      button.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="more" ref={root}>
      <button
        ref={button}
        type="button"
        className="icon-button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((was) => !was)}
      >
        <MoreIcon />
      </button>
      {open ? (
        <div id={id} className="more-items">
          {children(close)}
        </div>
      ) : null}
    </div>
  );
}
