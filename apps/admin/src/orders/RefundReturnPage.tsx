import type { AdminOrderDetail, AdminReasonCodeConfiguration } from '@tux/admin-contracts';
import { useEffect, useMemo, useState, type FormEvent } from 'react';

export type RefundDraft = {
  paymentId: string;
  amountMinor: number;
  reasonCodeId: string;
  note: string | null;
  pin: string;
};

export type ReturnDraft = {
  items: readonly { orderItemId: string; quantity: number }[];
  reasonCodeId: string;
  note: string | null;
  pin: string;
};

export function RefundReturnPage({
  order,
  reasons,
  refunding,
  returning,
  onCancel,
  onRefund,
  onReturn,
}: {
  order: AdminOrderDetail;
  reasons: readonly AdminReasonCodeConfiguration[];
  refunding: boolean;
  returning: boolean;
  onCancel(): void;
  onRefund(input: RefundDraft): void | Promise<void>;
  onReturn(input: ReturnDraft): void | Promise<void>;
}) {
  const [reasonCodeId, setReasonCodeId] = useState(reasons[0]?.id ?? '');
  const [paymentId, setPaymentId] = useState(order.payments[0]?.id ?? '');
  const [amountMinor, setAmountMinor] = useState(String(order.payments[0]?.allocatedMinor ?? ''));
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [returnQuantities, setReturnQuantities] = useState<Record<string, string>>({});

  useEffect(() => {
    if (reasons.some((reason) => reason.id === reasonCodeId)) return;
    setReasonCodeId(reasons[0]?.id ?? '');
  }, [reasonCodeId, reasons]);

  useEffect(() => {
    if (order.payments.some((payment) => payment.id === paymentId)) return;
    const payment = order.payments[0];
    setPaymentId(payment?.id ?? '');
    setAmountMinor(String(payment?.allocatedMinor ?? ''));
  }, [order.payments, paymentId]);

  const returnItems = useMemo(
    () =>
      order.items
        .map((item) => ({
          orderItemId: item.id,
          quantity: Number(returnQuantities[item.id] ?? '0'),
          maximum: item.quantity,
        }))
        .filter(
          (item) =>
            Number.isSafeInteger(item.quantity) &&
            item.quantity > 0 &&
            item.quantity <= item.maximum,
        )
        .map(({ orderItemId, quantity }) => ({ orderItemId, quantity })),
    [order.items, returnQuantities],
  );

  async function submitRefund(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedAmount = Number(amountMinor);
    if (!paymentId || !reasonCodeId || !pin || !Number.isSafeInteger(parsedAmount) || parsedAmount <= 0) {
      return;
    }
    await onRefund({
      paymentId,
      amountMinor: parsedAmount,
      reasonCodeId,
      note: note.trim() || null,
      pin,
    });
    setPin('');
  }

  async function submitReturn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reasonCodeId || !pin || returnItems.length === 0) return;
    await onReturn({
      items: returnItems,
      reasonCodeId,
      note: note.trim() || null,
      pin,
    });
    setPin('');
  }

  return (
    <section className="admin-catalog-editor__section" aria-labelledby="refund-return-title">
      <div className="admin-catalog-editor__section-heading">
        <div>
          <p className="admin-page__eyebrow">Sensitive order action</p>
          <h2 id="refund-return-title">Refund / return</h2>
        </div>
        <button className="admin-secondary-button" type="button" onClick={onCancel}>
          Back
        </button>
      </div>

      <label className="admin-field">
        <span>Reason</span>
        <select
          value={reasonCodeId}
          disabled={refunding || returning || reasons.length === 0}
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
          disabled={refunding || returning}
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
          disabled={refunding || returning}
          onChange={(event) => setPin(event.target.value)}
        />
      </label>

      <form className="admin-catalog-editor__section is-compact" onSubmit={(event) => void submitRefund(event)}>
        <h3>Refund payment</h3>
        <label className="admin-field">
          <span>Payment</span>
          <select value={paymentId} disabled={refunding || returning} onChange={(event) => {
            setPaymentId(event.target.value);
            const payment = order.payments.find((candidate) => candidate.id === event.target.value);
            if (payment) setAmountMinor(String(payment.allocatedMinor));
          }}>
            {order.payments.map((payment) => (
              <option key={payment.id} value={payment.id}>
                {payment.methodLabel} · {payment.allocatedMinor} minor
              </option>
            ))}
          </select>
        </label>
        <label className="admin-field">
          <span>Refund amount (minor units)</span>
          <input
            type="number"
            min={1}
            step={1}
            value={amountMinor}
            disabled={refunding || returning}
            onChange={(event) => setAmountMinor(event.target.value)}
          />
        </label>
        <button
          className="admin-primary-button"
          type="submit"
          disabled={refunding || returning || !reasonCodeId || !paymentId || !pin}
        >
          {refunding ? 'Refunding…' : 'Submit refund'}
        </button>
      </form>

      <form className="admin-catalog-editor__section is-compact" onSubmit={(event) => void submitReturn(event)}>
        <h3>Return items</h3>
        {order.items.map((item) => (
          <label className="admin-field" key={item.id}>
            <span>{item.productName} · max {item.quantity}</span>
            <input
              aria-label={`Return quantity for ${item.productName}`}
              type="number"
              min={0}
              max={item.quantity}
              step={1}
              value={returnQuantities[item.id] ?? '0'}
              disabled={refunding || returning}
              onChange={(event) =>
                setReturnQuantities((current) => ({ ...current, [item.id]: event.target.value }))
              }
            />
          </label>
        ))}
        <button
          className="admin-primary-button"
          type="submit"
          disabled={refunding || returning || !reasonCodeId || !pin || returnItems.length === 0}
        >
          {returning ? 'Returning…' : 'Return selected items'}
        </button>
      </form>
    </section>
  );
}
