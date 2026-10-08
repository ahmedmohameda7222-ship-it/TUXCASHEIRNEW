import type { AdminSettingsWorkspace } from '@tux/admin-contracts';
import { useState, type FormEvent } from 'react';

import { sortOrderAfterMove } from './settingsModel';
import type { OrderTypeUpdateDraft } from './useSettings';

export type OrderTypesPageProps = {
  workspace: AdminSettingsWorkspace;
  updating: boolean;
  onUpdate(draft: OrderTypeUpdateDraft): void | Promise<void>;
};

function behaviorLabel(behavior: AdminSettingsWorkspace['orderTypes'][number]['behavior']): string {
  if (behavior === 'TAKE_AWAY') return 'Take Away';
  if (behavior === 'DINE_IN') return 'Dine In';
  if (behavior === 'DELIVERY') return 'Delivery';
  return 'Other';
}

export function OrderTypesPage({ workspace, updating, onUpdate }: OrderTypesPageProps) {
  const [draft, setDraft] = useState<OrderTypeUpdateDraft | null>(null);

  function beginEdit(orderType: AdminSettingsWorkspace['orderTypes'][number]) {
    setDraft({
      orderTypeId: orderType.id,
      name: orderType.name,
      behavior: orderType.behavior,
      active: orderType.active,
      sortOrder: orderType.sortOrder,
      expectedSettingsVersion: workspace.settingsVersion,
      expectedEditVersion: orderType.editVersion,
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || updating) return;
    const name = draft.name.trim();
    if (!name) return;
    await onUpdate({ ...draft, name });
    setDraft(null);
  }

  return (
    <section className="admin-settings-section" aria-labelledby="settings-order-types-title">
      <div className="admin-settings-section__header">
        <div>
          <p className="admin-settings-kicker">Ways customers receive orders</p>
          <h2 id="settings-order-types-title">Order types</h2>
        </div>
        <span className="admin-status-pill">{workspace.orderTypes.length} configured</span>
      </div>
      <p className="admin-settings-muted">
        Choose the name, behavior, availability, and display position for each order type.
      </p>
      <div className="admin-settings-list">
        {workspace.orderTypes.map((orderType) => {
          if (draft?.orderTypeId === orderType.id) {
            const activeId = `order-type-active-${orderType.id}`;
            const ordered = [...workspace.orderTypes].sort(
              (left, right) => left.sortOrder - right.sortOrder,
            );
            const position = ordered.findIndex((item) => item.id === orderType.id);
            const previous = position > 0 ? ordered[position - 1] : undefined;
            const next = position < ordered.length - 1 ? ordered[position + 1] : undefined;
            return (
              <form
                className="admin-settings-row admin-settings-row--stack"
                key={orderType.id}
                onSubmit={(event) => void submit(event)}
              >
                <div className="admin-settings-grid">
                  <label className="admin-field">
                    <span>Order type name</span>
                    <input
                      value={draft.name}
                      maxLength={120}
                      required
                      disabled={updating}
                      onChange={(event) => {
                        const name = event.currentTarget.value;
                        setDraft((current) => (current ? { ...current, name } : current));
                      }}
                    />
                  </label>
                  <label className="admin-field">
                    <span>Behavior</span>
                    <select
                      value={draft.behavior}
                      disabled={updating}
                      onChange={(event) => {
                        const behavior = event.currentTarget
                          .value as OrderTypeUpdateDraft['behavior'];
                        setDraft((current) => (current ? { ...current, behavior } : current));
                      }}
                    >
                      <option value="TAKE_AWAY">Take Away</option>
                      <option value="DINE_IN">Dine In</option>
                      <option value="DELIVERY">Delivery</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </label>
                  <div className="admin-field">
                    <span>Display position</span>
                    <div className="admin-settings-row__main">
                      <button
                        className="admin-secondary-button"
                        type="button"
                        disabled={updating || !previous}
                        onClick={() =>
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  sortOrder: sortOrderAfterMove(
                                    workspace.orderTypes,
                                    orderType.id,
                                    'up',
                                  ),
                                }
                              : current,
                          )
                        }
                      >
                        Move up
                      </button>
                      <button
                        className="admin-secondary-button"
                        type="button"
                        disabled={updating || !next}
                        onClick={() =>
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  sortOrder: sortOrderAfterMove(
                                    workspace.orderTypes,
                                    orderType.id,
                                    'down',
                                  ),
                                }
                              : current,
                          )
                        }
                      >
                        Move down
                      </button>
                    </div>
                  </div>
                  <label className="admin-check-field" htmlFor={activeId}>
                    <input
                      id={activeId}
                      type="checkbox"
                      checked={draft.active}
                      disabled={updating}
                      onChange={(event) => {
                        const active = event.currentTarget.checked;
                        setDraft((current) => (current ? { ...current, active } : current));
                      }}
                    />
                    <span>Order type active</span>
                  </label>
                </div>
                <div className="admin-settings-row__main">
                  <button className="admin-primary-button" type="submit" disabled={updating}>
                    {updating ? 'Saving…' : 'Save order type'}
                  </button>
                  <button
                    className="admin-secondary-button"
                    type="button"
                    disabled={updating}
                    onClick={() => setDraft(null)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            );
          }

          return (
            <div className="admin-settings-row" key={orderType.id}>
              <div>
                <strong>{orderType.name}</strong>
                <span>{behaviorLabel(orderType.behavior)}</span>
              </div>
              <div className="admin-settings-row__main">
                <span
                  className={orderType.active ? 'admin-status-pill' : 'admin-status-pill is-muted'}
                >
                  {orderType.active ? 'Active' : 'Inactive'}
                </span>
                <button
                  className="admin-secondary-button"
                  type="button"
                  disabled={updating}
                  onClick={() => beginEdit(orderType)}
                >
                  Edit {orderType.name}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
