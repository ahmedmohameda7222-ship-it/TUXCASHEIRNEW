import type { AdminSettingsWorkspace } from '@tux/admin-contracts';
import { useState, type FormEvent } from 'react';

import type { OrderTypeUpdateDraft } from './useSettings';

export type OrderTypesPageProps = {
  workspace: AdminSettingsWorkspace;
  updating: boolean;
  onUpdate(draft: OrderTypeUpdateDraft): void | Promise<void>;
};

export function OrderTypesPage({ workspace, updating, onUpdate }: OrderTypesPageProps) {
  const [draft, setDraft] = useState<OrderTypeUpdateDraft | null>(null);

  function beginEdit(orderType: AdminSettingsWorkspace['orderTypes'][number]) {
    setDraft({
      orderTypeId: orderType.id,
      name: orderType.name,
      behavior: orderType.behavior,
      active: orderType.active,
      sortOrder: orderType.sortOrder,
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
          <p className="admin-settings-kicker">Canonical fulfillment authority</p>
          <h2 id="settings-order-types-title">Order types</h2>
        </div>
        <span className="admin-status-pill">{workspace.orderTypes.length} configured</span>
      </div>
      <p className="admin-settings-muted">
        These are the existing canonical order types consumed by Operations and online ordering.
        Changes remain draft settings until you publish.
      </p>
      <div className="admin-settings-list">
        {workspace.orderTypes.map((orderType) => {
          if (draft?.orderTypeId === orderType.id) {
            const activeId = `order-type-active-${orderType.id}`;
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
                        const behavior = event.currentTarget.value as OrderTypeUpdateDraft['behavior'];
                        setDraft((current) => (current ? { ...current, behavior } : current));
                      }}
                    >
                      <option value="TAKE_AWAY">Take away</option>
                      <option value="DINE_IN">Dine in</option>
                      <option value="DELIVERY">Delivery</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </label>
                  <label className="admin-field">
                    <span>Sort order</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={draft.sortOrder}
                      disabled={updating}
                      onChange={(event) => {
                        const sortOrder = Number(event.currentTarget.value);
                        setDraft((current) => (current ? { ...current, sortOrder } : current));
                      }}
                    />
                  </label>
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
                <span>
                  {orderType.behavior} · sort {orderType.sortOrder}
                </span>
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
