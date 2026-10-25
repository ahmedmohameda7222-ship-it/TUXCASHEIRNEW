import type { AdminOrderDetail, AdminReasonCodeConfiguration } from '@tux/admin-contracts';
import { useEffect, useState, type FormEvent } from 'react';

import { AdminDialog } from '../components/overlay/AdminDialog';

export type CancelOrderDraft = {
  reasonCodeId: string;
  note: string | null;
  pin: string;
};

export function CancelOrderSheet({
  reasons,
  order,
  pending,
  onCancel,
  onSubmit,
}: {
  reasons: readonly AdminReasonCodeConfiguration[];
  order?: AdminOrderDetail;
  pending: boolean;
  onCancel(): void;
  onSubmit(input: CancelOrderDraft): void | Promise<void>;
}) {
  const [reasonCodeId, setReasonCodeId] = useState(reasons[0]?.id ?? '');
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const recordedPaymentMinor =
    order?.payments.reduce((sum, payment) => sum + payment.allocatedMinor, 0) ?? 0;
  const postedRefundMinor =
    order?.payments.reduce((sum, payment) => sum + (payment.postedRefundMinor ?? 0), 0) ?? 0;
  const pendingRefundMinor =
    order?.payments.reduce((sum, payment) => sum + (payment.pendingRefundMinor ?? 0), 0) ?? 0;
  const remainingRefundableMinor =
    order?.payments.reduce((sum, payment) => sum + (payment.remainingRefundableMinor ?? 0), 0) ?? 0;
  const paidActiveOrder = order?.status === 'ACTIVE' && recordedPaymentMinor > 0;
  const money = (minor: number) => `${(minor / 100).toFixed(2)} EGP`;

  useEffect(() => {
    if (reasons.some((reason) => reason.id === reasonCodeId)) return;
    setReasonCodeId(reasons[0]?.id ?? '');
  }, [reasonCodeId, reasons]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reasonCodeId || !pin || paidActiveOrder) return;
    await onSubmit({ reasonCodeId, note: note.trim() || null, pin });
    setPin('');
  }

  return (
    <AdminDialog
      open
      variant="sheet"
      title="Cancel order"
      description="Choose the business reason and confirm this sensitive action with your Admin PIN."
      destructive
      onOpenChange={(open) => {
        if (!open && !pending) onCancel();
      }}
    >
      {order ? (
        <section
          className="admin-order-task-section is-compact"
          aria-label="Financial and inventory consequences"
        >
          <h3>Financial consequences</h3>
          <p>Order total: {money(order.totalMinor)}</p>
          <p>Recorded payments: {money(recordedPaymentMinor)}</p>
          {order.payments.map((payment) => (
            <p key={payment.id}>
              {payment.methodLabel}: {money(payment.allocatedMinor)}
            </p>
          ))}
          <p>Previously posted refunds: {money(postedRefundMinor)}</p>
          <p>Pending refund requests: {money(pendingRefundMinor)}</p>
          <p>Remaining refundable amount: {money(remainingRefundableMinor)}</p>
          <p>
            Inventory: unpaid cancellation releases eligible active reservations; consumed stock is
            not automatically restocked.
          </p>
          {paidActiveOrder ? (
            <p role="alert">
              You cannot cancel an ACTIVE order with recorded payments. This action does not refund
              the customer. Request authorized financial settlement before any lifecycle correction;
              refunds and external payment reversals must be confirmed separately.
            </p>
          ) : (
            <p>
              Unpaid ACTIVE order: cancellation uses the normal audited reservation-release flow.
            </p>
          )}
        </section>
      ) : null}
      <form
        className="admin-order-task-section is-compact"
        onSubmit={(event) => void submit(event)}
      >
        <label className="admin-field">
          <span>Cancellation reason</span>
          <select
            value={reasonCodeId}
            disabled={pending || reasons.length === 0}
            onChange={(event) => setReasonCodeId(event.target.value)}
          >
            {reasons.map((reason) => (
              <option key={reason.id} value={reason.id}>
                {reason.label}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-field">
          <span>Note</span>
          <textarea
            value={note}
            maxLength={500}
            disabled={pending}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <label className="admin-field">
          <span>Admin PIN</span>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            value={pin}
            disabled={pending}
            onChange={(event) => setPin(event.target.value)}
          />
        </label>
        <div className="admin-page__primary-action">
          <button
            className="admin-secondary-button"
            type="button"
            disabled={pending}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="admin-destructive-button"
            type="submit"
            disabled={pending || paidActiveOrder || !reasonCodeId || !pin}
          >
            {pending ? 'Cancelling…' : 'Confirm cancellation'}
          </button>
        </div>
      </form>
    </AdminDialog>
  );
}
