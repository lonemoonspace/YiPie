import type { ReactNode } from 'react';
import type { MoveDirection } from '@/contract/mutations';
import type { ListView } from '@/contract/rpc';
import { t } from '@/domain/i18n';

/** What the page owes the user about how a list was read (docs/development-plan.md §7). */
export function ListNotices({ view }: { view: ListView<unknown> }) {
  return (
    <>
      {view.readOnly ? (
        <p role="alert" className="notice">
          {t('settings.readOnly')}
        </p>
      ) : view.status === 'invalid' ? (
        <p role="alert" className="notice">
          {t('settings.invalid')}
        </p>
      ) : null}
      {view.defaultUnreadable ? <p className="notice">{t('list.defaultUnreadable')}</p> : null}
      {view.unrecognized > 0 ? (
        <p className="hint list-note">{t('list.unrecognized', { count: view.unrecognized })}</p>
      ) : null}
    </>
  );
}

interface ItemRowProps {
  name: string;
  details: ReactNode;
  isDefault: boolean;
  first: boolean;
  last: boolean;
  /** No changes while one is in flight, or when the list is read-only. */
  locked: boolean;
  /** Badges after the name, besides "default". */
  badges?: ReactNode;
  /** Actions after the common ones. */
  actions?: ReactNode;
  /** The editor, when this item is being edited. */
  children?: ReactNode;
  onSetDefault: () => void;
  onEdit: () => void;
  onMove: (direction: MoveDirection) => void;
  onRemove: () => void;
}

/**
 * One configuration in a list, with the changes the list offers. Each button
 * names its item for screen readers, since every row has the same buttons.
 */
export function ItemRow(props: ItemRowProps) {
  const { name, locked } = props;
  return (
    <li className="item">
      <div className="item-main">
        <span className="item-name">{name}</span>
        {props.isDefault ? <span className="badge">{t('list.default')}</span> : null}
        {props.badges}
      </div>
      <div className="item-details">{props.details}</div>
      <div className="item-actions">
        {props.isDefault ? null : (
          <button
            type="button"
            className="secondary"
            aria-label={t('list.setDefault.label', { name })}
            disabled={locked}
            onClick={props.onSetDefault}
          >
            {t('list.setDefault')}
          </button>
        )}
        <button
          type="button"
          className="secondary"
          aria-label={t('list.edit.label', { name })}
          onClick={props.onEdit}
        >
          {t('list.edit')}
        </button>
        <button
          type="button"
          className="secondary"
          aria-label={t('list.moveUp.label', { name })}
          disabled={locked || props.first}
          onClick={() => props.onMove('up')}
        >
          {t('list.moveUp')}
        </button>
        <button
          type="button"
          className="secondary"
          aria-label={t('list.moveDown.label', { name })}
          disabled={locked || props.last}
          onClick={() => props.onMove('down')}
        >
          {t('list.moveDown')}
        </button>
        <button
          type="button"
          className="secondary danger"
          aria-label={t('list.remove.label', { name })}
          disabled={locked}
          onClick={props.onRemove}
        >
          {t('list.remove')}
        </button>
        {props.actions}
      </div>
      {props.children}
    </li>
  );
}
