import { useState, type FormEvent } from 'react';

import { approvalDecisionDialogTitle, type ApprovalDecisionKind } from './ApprovalDetailPage';

export function RePinDialog({
  decision,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  decision: ApprovalDecisionKind;
  busy: boolean;
  error?: string;
  onCancel(): void;
  onConfirm(pin: string, reason: string | null): Promise<void>;
}) {
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pin.trim() === '') return;
    try {
      await onConfirm(pin, reason.trim() || null);
    } catch {
      // Mutation state renders the safe error message while the dialog stays open.
    }
  }

  return (
    <div className="admin-dialog-backdrop" role="presentation">
      <section className="admin-dialog" role="dialog" aria-modal="true" aria-labelledby="repin-title">
        <h2 id="repin-title">{approvalDecisionDialogTitle(decision)}</h2>
        <p>
          Confirm with your own PIN. The requester cannot approve their own request, including an
          OWNER requester.
        </p>
        <form onSubmit={(event) => void submit(event)}>
          <label className="admin-field">
            <span>PIN</span>
            <input
              autoComplete="current-password"
              inputMode="numeric"
              name="pin"
              type="password"
              value={pin}
              onChange={(event) => setPin(event.currentTarget.value)}
            />
          </label>
          <label className="admin-field">
            <span>Decision note</span>
            <textarea
              name="reason"
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.currentTarget.value)}
            />
          </label>
          {error ? <p className="admin-error-text">{error}</p> : null}
          <div className="admin-approval-actions">
            <button className="admin-primary-button" type="submit" disabled={busy || pin.trim() === ''}>
              {busy ? 'Confirming…' : `Confirm ${decision === 'APPROVE' ? 'approval' : 'rejection'}`}
            </button>
            <button className="admin-secondary-button" type="button" disabled={busy} onClick={onCancel}>
              Cancel
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
