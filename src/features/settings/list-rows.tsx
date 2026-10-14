import { useState, type ReactNode } from 'react';
import { t } from '@/domain/i18n';

export interface ListRowsProps<Item extends { id: string }> {
  items: Item[];
  defaultId: string | null;
  /** Read-only list or an operation in flight. */
  disabled: boolean;
  /** The row's name: shown, and its accessible name. */
  name(item: Item): string;
  /** A second line under the name. */
  detail?(item: Item): ReactNode;
  /** The id being edited; its editor replaces the row's buttons. */
  editingId: string | null;
  editor(item: Item): ReactNode;
  onSetDefault(id: string): void;
  onMove(id: string, by: -1 | 1): void;
  onEdit(id: string): void;
  onRemove(id: string): void;
}

/** A user's list on the settings page; deleting asks once more, in place. */
export function ListRows<Item extends { id: string }>(props: ListRowsProps<Item>): ReactNode {
  const [confirming, setConfirming] = useState<string | null>(null);
  const last = props.items.length - 1;

  return (
    <ul className="rows">
      {props.items.map((item, index) => {
        const name = props.name(item);
        const isDefault = item.id === props.defaultId;
        return (
          <li key={item.id} className="row" aria-label={name}>
            <div className="row-head">
              <div className="row-text">
                <span className="row-name">{name}</span>
                {isDefault ? <span className="badge">{t('list.default')}</span> : null}
                {props.detail ? <div className="row-detail">{props.detail(item)}</div> : null}
              </div>
              {props.editingId === item.id ? null : confirming === item.id ? (
                <div className="row-actions">
                  <button
                    type="button"
                    className="danger"
                    disabled={props.disabled}
                    onClick={() => {
                      setConfirming(null);
                      props.onRemove(item.id);
                    }}
                  >
                    {t('list.confirmRemove')}
                  </button>
                  <button type="button" className="quiet" onClick={() => setConfirming(null)}>
                    {t('list.cancel')}
                  </button>
                </div>
              ) : (
                <div className="row-actions">
                  {isDefault ? null : (
                    <button
                      type="button"
                      className="quiet"
                      disabled={props.disabled}
                      onClick={() => props.onSetDefault(item.id)}
                    >
                      {t('list.setDefault')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="quiet"
                    disabled={props.disabled || index === 0}
                    onClick={() => props.onMove(item.id, -1)}
                  >
                    {t('list.moveUp')}
                  </button>
                  <button
                    type="button"
                    className="quiet"
                    disabled={props.disabled || index === last}
                    onClick={() => props.onMove(item.id, 1)}
                  >
                    {t('list.moveDown')}
                  </button>
                  <button
                    type="button"
                    className="quiet"
                    disabled={props.disabled}
                    onClick={() => props.onEdit(item.id)}
                  >
                    {t('list.edit')}
                  </button>
                  <button
                    type="button"
                    className="quiet"
                    disabled={props.disabled}
                    onClick={() => setConfirming(item.id)}
                  >
                    {t('list.remove')}
                  </button>
                </div>
              )}
            </div>
            {props.editingId === item.id ? props.editor(item) : null}
          </li>
        );
      })}
    </ul>
  );
}
