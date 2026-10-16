import type { AdminSettingsWorkspace, PaymentMethodUpdateResult } from '@tux/admin-contracts';
import { useState, type FormEvent } from 'react';

import { sortOrderAfterMove } from './settingsModel';
import type { PaymentMethodCreateDraft, PaymentMethodUpdateDraft } from './useSettings';

export type PaymentsPageProps = {
  workspace: AdminSettingsWorkspace;
  updating: boolean;
  onCreate(draft: PaymentMethodCreateDraft): void | Promise<void>;
  onUpdate(
    draft: PaymentMethodUpdateDraft,
  ): void | PaymentMethodUpdateResult | Promise<void | PaymentMethodUpdateResult>;
};

function channelLabel(
  channel: AdminSettingsWorkspace['paymentMethods'][number]['channel'],
): string {
  if (channel === 'POS') return 'In-store';
  if (channel === 'ONLINE') return 'Online';
  return 'In-store & Online';
}

export function PaymentsPage({ workspace, updating, onCreate, onUpdate }: PaymentsPageProps) {
  const [draft, setDraft] = useState<PaymentMethodUpdateDraft | null>(null);
  const [createDraft, setCreateDraft] = useState<PaymentMethodCreateDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createDraft || updating || !createDraft.displayName.trim()) return;
    setError(null);
    try {
      await onCreate({ ...createDraft, displayName: createDraft.displayName.trim() });
      setCreateDraft(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create payment method.');
    }
  }

  function beginEdit(method: AdminSettingsWorkspace['paymentMethods'][number]) {
    setNotice(null);
    setError(null);
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
    setError(null);
    setNotice(null);
    try {
      const result = await onUpdate({ ...draft, displayName });
      if (result && 'state' in result && result.state === 'PENDING_APPROVAL') {
        setNotice(
          'Payment update requested. A second person must approve it before the method changes.',
        );
      } else {
        setNotice('Payment method updated.');
      }
      setDraft(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update payment method.');
    }
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
      {notice ? (
        <p role="status" className="admin-settings-muted">
          {notice}
        </p>
      ) : null}
      <p className="admin-settings-muted">
        Refund eligibility is captured when a payment is taken. Changes affect future payments only.
      </p>
      <div className="admin-settings-row__main">
        <button
          className="admin-primary-button"
          type="button"
          disabled={updating || createDraft !== null}
          onClick={() =>
            setCreateDraft({
              commandId: crypto.randomUUID(),
              displayName: '',
              logicType: 'CASH',
              active: true,
              sortOrder:
                workspace.paymentMethods.reduce(
                  (max, method) => Math.max(max, method.sortOrder),
                  0,
                ) + 10,
              channel: 'POS',
              requiresReference: false,
              manualConfirmationRequired: false,
              refundAllowed: true,
              expectedSettingsVersion: workspace.settingsVersion,
            })
          }
        >
          Add payment method
        </button>
      </div>
      {createDraft ? (
        <form
          className="admin-settings-row admin-settings-row--stack"
          onSubmit={(event) => void submitCreate(event)}
        >
          <div className="admin-settings-grid">
            <label className="admin-field">
              <span>New payment method name</span>
              <input
                required
                maxLength={120}
                value={createDraft.displayName}
                disabled={updating}
                onChange={(event) => {
                  const displayName = event.currentTarget.value;
                  setCreateDraft((current) => (current ? { ...current, displayName } : current));
                }}
              />
            </label>
            <label className="admin-field">
              <span>Payment type</span>
              <select
                value={createDraft.logicType}
                disabled={updating}
                onChange={(event) => {
                  const logicType = event.currentTarget
                    .value as PaymentMethodCreateDraft['logicType'];
                  setCreateDraft((current) => (current ? { ...current, logicType } : current));
                }}
              >
                <option value="CASH">Cash</option>
                <option value="CARD">Card</option>
                <option value="DIGITAL">Digital</option>
                <option value="OTHER">Other</option>
              </select>
            </label>
            <label className="admin-field">
              <span>New method availability</span>
              <select
                value={createDraft.channel}
                disabled={updating}
                onChange={(event) => {
                  const channel = event.currentTarget.value as PaymentMethodCreateDraft['channel'];
                  setCreateDraft((current) => (current ? { ...current, channel } : current));
                }}
              >
                <option value="POS">In-store</option>
                <option value="ONLINE">Online</option>
                <option value="BOTH">In-store &amp; Online</option>
              </select>
            </label>
            <label className="admin-check-field">
              <input
                type="checkbox"
                checked={createDraft.active}
                disabled={updating}
                onChange={(event) => {
                  const active = event.currentTarget.checked;
                  setCreateDraft((current) => (current ? { ...current, active } : current));
                }}
              />
              <span>Active on creation</span>
            </label>
            <label className="admin-check-field">
              <input
                type="checkbox"
                checked={createDraft.requiresReference}
                disabled={updating}
                onChange={(event) => {
                  const requiresReference = event.currentTarget.checked;
                  setCreateDraft((current) =>
                    current ? { ...current, requiresReference } : current,
                  );
                }}
              />
              <span>Require payment reference</span>
            </label>
            <label className="admin-check-field">
              <input
                type="checkbox"
                checked={createDraft.manualConfirmationRequired}
                disabled={updating}
                onChange={(event) => {
                  const manualConfirmationRequired = event.currentTarget.checked;
                  setCreateDraft((current) =>
                    current ? { ...current, manualConfirmationRequired } : current,
                  );
                }}
              />
              <span>Require manual confirmation</span>
            </label>
            <label className="admin-check-field">
              <input
                type="checkbox"
                checked={createDraft.refundAllowed}
                disabled={updating}
                onChange={(event) => {
                  const refundAllowed = event.currentTarget.checked;
                  setCreateDraft((current) => (current ? { ...current, refundAllowed } : current));
                }}
              />
              <span>Refunds allowed for new payments</span>
            </label>
          </div>
          {error ? <p className="admin-field__error">{error}</p> : null}
          <div className="admin-settings-row__main">
            <button className="admin-primary-button" type="submit" disabled={updating}>
              {updating ? 'Creating…' : 'Create payment method'}
            </button>
            <button
              className="admin-secondary-button"
              type="button"
              disabled={updating}
              onClick={() => {
                setCreateDraft(null);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
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
                  <label className="admin-check-field">
                    <input
                      type="checkbox"
                      checked={draft.refundAllowed}
                      disabled={updating}
                      onChange={(event) => {
                        const refundAllowed = event.currentTarget.checked;
                        setDraft((current) => (current ? { ...current, refundAllowed } : current));
                      }}
                    />
                    <span>Refunds allowed for new payments</span>
                  </label>
                  <label className="admin-field">
                    <span>Requester PIN (when required by approval policy)</span>
                    <input
                      type="password"
                      autoComplete="off"
                      maxLength={64}
                      value={draft.requesterPin ?? ''}
                      disabled={updating}
                      onChange={(event) => {
                        const requesterPin = event.currentTarget.value;
                        setDraft((current) => (current ? { ...current, requesterPin } : current));
                      }}
                    />
                  </label>
                </div>
                {error ? (
                  <p className="admin-field__error" role="alert">
                    {error}
                  </p>
                ) : null}
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
                <span>
                  {method.refundAllowed
                    ? 'Refunds allowed for new payments'
                    : 'Refunds disabled for new payments'}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
