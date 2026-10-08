import type { AdminSettingsWorkspace } from '@tux/admin-contracts';
import { useState, type FormEvent } from 'react';

import { sortOrderAfterMove } from './settingsModel';
import type { PaymentMethodUpdateDraft } from './useSettings';

export type PaymentsPageProps = {
  workspace: AdminSettingsWorkspace;
  updating: boolean;
  onUpdate(draft: PaymentMethodUpdateDraft): void | Promise<void>;
};

function channelLabel(
  channel: AdminSettingsWorkspace['paymentMethods'][number]['channel'],
): string {
  if (channel === 'POS') return 'In-store';
  if (channel === 'ONLINE') return 'Online';
  return 'In-store & Online';
}

export function PaymentsPage({ workspace, updating, onUpdate }: PaymentsPageProps) {
  const [draft, setDraft] = useState<PaymentMethodUpdateDraft | null>(null);

  function beginEdit(method: AdminSettingsWorkspace['paymentMethods'][number]) {
    setDraft({
      paymentMethodId: method.id,
      displayName: method.displayName,
      active: method.active,
      sortOrder: method.sortOrder,
      channel: method.channel,
      requiresReference: method.requiresReference,
      manualConfirmationRequired: method.manualConfirmationRequired,
      refundAllowed: method.refundAllowed,
      expectedSettingsVersion: workspace.settingsVersion,
      expectedEditVersion: method.editVersion,
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || updating) return;
    const displayName = draft.displayName.trim();
    if (!displayName) return;
    await onUpdate({ ...draft, displayName });
    setDraft(null);
  }

  return (
    <section className="admin-settings-section" aria-labelledby="settings-payments-title">
      <div className="admin-settings-section__header">
        <div>
          <p className="admin-settings-kicker">Customer payment choices</p>
          <h2 id="settings-payments-title">Payments</h2>
        </div>
        <span className="admin-status-pill">{workspace.paymentMethods.length} configured</span>
      </div>
      <p className="admin-settings-muted">
        Choose where each payment method is available and what staff must enter at checkout.
      </p>
      <div className="admin-callout" role="status">
        <strong>Refund policy editing is not available yet.</strong>
        <span>
          Existing refund rules remain unchanged. Refund controls will appear here when that
          workflow is available to staff.
        </span>
      </div>
      <div className="admin-settings-list">
        {workspace.paymentMethods.map((method) => {
          if (draft?.paymentMethodId === method.id) {
            const ordered = [...workspace.paymentMethods].sort(
              (left, right) => left.sortOrder - right.sortOrder,
            );
            const position = ordered.findIndex((item) => item.id === method.id);
            const previous = position > 0 ? ordered[position - 1] : undefined;
            const next = position < ordered.length - 1 ? ordered[position + 1] : undefined;
            return (
              <form
                className="admin-settings-row admin-settings-row--stack"
                key={method.id}
                onSubmit={(event) => void submit(event)}
              >
                <div className="admin-settings-grid">
                  <label className="admin-field">
                    <span>Payment method name</span>
                    <input
                      value={draft.displayName}
                      maxLength={120}
                      required
                      disabled={updating}
                      onChange={(event) => {
                        const displayName = event.currentTarget.value;
                        setDraft((current) => (current ? { ...current, displayName } : current));
                      }}
                    />
                  </label>
                  <label className="admin-field">
                    <span>Available for</span>
                    <select
                      value={draft.channel}
                      disabled={updating}
                      onChange={(event) => {
                        const channel = event.currentTarget
                          .value as PaymentMethodUpdateDraft['channel'];
                        setDraft((current) => (current ? { ...current, channel } : current));
                      }}
                    >
                      <option value="POS">In-store</option>
                      <option value="ONLINE">Online</option>
                      <option value="BOTH">In-store &amp; Online</option>
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
                                    workspace.paymentMethods,
                                    method.id,
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
                                    workspace.paymentMethods,
                                    method.id,
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
                  <label className="admin-check-field">
                    <input
                      type="checkbox"
                      checked={draft.active}
                      disabled={updating}
                      onChange={(event) => {
                        const active = event.currentTarget.checked;
                        setDraft((current) => (current ? { ...current, active } : current));
                      }}
                    />
                    <span>Active</span>
                  </label>
                  <label className="admin-check-field">
                    <input
                      type="checkbox"
                      checked={draft.requiresReference}
                      disabled={updating}
                      onChange={(event) => {
                        const requiresReference = event.currentTarget.checked;
                        setDraft((current) =>
                          current ? { ...current, requiresReference } : current,
                        );
                      }}
                    />
                    <span>Reference required</span>
                  </label>
                  <label className="admin-check-field">
                    <input
                      type="checkbox"
                      checked={draft.manualConfirmationRequired}
                      disabled={updating}
                      onChange={(event) => {
                        const manualConfirmationRequired = event.currentTarget.checked;
                        setDraft((current) =>
                          current ? { ...current, manualConfirmationRequired } : current,
                        );
                      }}
                    />
                    <span>Manual confirmation</span>
                  </label>
                </div>
                <div className="admin-settings-row__main">
                  <button className="admin-primary-button" type="submit" disabled={updating}>
                    {updating ? 'Saving…' : 'Save payment method'}
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
            <div className="admin-settings-row admin-settings-row--stack" key={method.id}>
              <div className="admin-settings-row__main">
                <div>
                  <strong>{method.displayName}</strong>
                  <span>{channelLabel(method.channel)}</span>
                </div>
                <div className="admin-settings-row__main">
                  <span
                    className={method.active ? 'admin-status-pill' : 'admin-status-pill is-muted'}
                  >
                    {method.active ? 'Active' : 'Inactive'}
                  </span>
                  <button
                    className="admin-secondary-button"
                    type="button"
                    disabled={updating}
                    onClick={() => beginEdit(method)}
                  >
                    Edit {method.displayName}
                  </button>
                </div>
              </div>
              <div className="admin-settings-tags">
                {method.requiresReference ? <span>Reference required</span> : null}
                {method.manualConfirmationRequired ? <span>Manual confirmation</span> : null}
                {method.requiresReconciliation ? <span>Reconciled</span> : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
