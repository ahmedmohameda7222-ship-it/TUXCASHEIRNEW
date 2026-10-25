import type { AdminOrderDetail, AdminReasonCodeConfiguration } from '@tux/admin-contracts';
import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { AdminDialog } from '../components/overlay/AdminDialog';

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

function money(minor: number): string {
  return `${(minor / 100).toFixed(2)} EGP`;
}

type ReturnSelectableItem = Pick<
  AdminOrderDetail['items'][number],
  'id' | 'remainingReturnableQuantity'
>;

/** Reject the complete form if any selected line is invalid; never submit a silent subset. */
export function buildReturnItemSelection(
  items: readonly ReturnSelectableItem[],
  quantities: Readonly<Record<string, string>>,
): {
  items: { orderItemId: string; quantity: number }[];
  hasInvalidQuantity: boolean;
} {
  const selected: { orderItemId: string; quantity: number }[] = [];
  let hasInvalidQuantity = false;
  for (const item of items) {
    const raw = (quantities[item.id] ?? '0').trim();
    if (raw === '' || raw === '0') continue;
    const quantity = Number(raw);
    if (
      !/^\d+$/.test(raw) ||
      !Number.isSafeInteger(quantity) ||
      quantity <= 0 ||
      quantity > (item.remainingReturnableQuantity ?? 0)
    ) {
      hasInvalidQuantity = true;
      continue;
    }
    selected.push({ orderItemId: item.id, quantity });
  }
  return {
    items: hasInvalidQuantity ? [] : selected,
    hasInvalidQuantity,
  };
}

export function RefundReturnPage({
  mode,
  order,
  reasons,
  refunding,
  returning,
  onCancel,
  onRefund,
  onReturn,
}: {
  mode: 'refund' | 'return';
  order: AdminOrderDetail;
  reasons: readonly AdminReasonCodeConfiguration[];
  refunding: boolean;
  returning: boolean;
  onCancel(): void;
  onRefund(input: RefundDraft): void | Promise<void>;
  onReturn(input: ReturnDraft): void | Promise<void>;
}) {
  const [reasonCodeId, setReasonCodeId] = useState(reasons[0]?.id ?? '');
  const refundablePayments = useMemo(
    () =>
      order.payments.filter(
        (payment) =>
          payment.refundAllowedSnapshot === true && (payment.remainingRefundableMinor ?? 0) > 0,
      ),
    [order.payments],
  );
  const [paymentId, setPaymentId] = useState(refundablePayments[0]?.id ?? '');
  const [amountMinor, setAmountMinor] = useState(
    String(refundablePayments[0]?.remainingRefundableMinor ?? ''),
  );
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [returnQuantities, setReturnQuantities] = useState<Record<string, string>>({});

  useEffect(() => {
    if (reasons.some((reason) => reason.id === reasonCodeId)) return;
    setReasonCodeId(reasons[0]?.id ?? '');
  }, [reasonCodeId, reasons]);

  useEffect(() => {
    const selected = refundablePayments.find((payment) => payment.id === paymentId);
    if (!selected) {
      const next = refundablePayments[0];
      setPaymentId(next?.id ?? '');
      setAmountMinor(String(next?.remainingRefundableMinor ?? ''));
      return;
    }
    const maximum = selected.remainingRefundableMinor ?? 0;
    setAmountMinor((current) => {
      const amount = Number(current);
      return String(
        Number.isSafeInteger(amount) && amount > 0 && amount <= maximum ? amount : maximum,
      );
    });
  }, [refundablePayments, paymentId]);

  const returnSelection = useMemo(
    () => buildReturnItemSelection(order.items, returnQuantities),
    [order.items, returnQuantities],
  );
  const returnItems = returnSelection.items;
  const returnEstimatedGrossMinor = returnItems.reduce((total, line) => {
    const item = order.items.find((candidate) => candidate.id === line.orderItemId);
    if (!item) return total;
    const extrasMinor = item.modifiers.reduce(
      (sum, modifier) => sum + modifier.quantity * modifier.unitPriceMinor,
      0,
    );
    return total + (item.unitPriceMinor + extrasMinor) * line.quantity;
  }, 0);

  async function submitRefund(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedAmount = Number(amountMinor);
    const payment = refundablePayments.find((candidate) => candidate.id === paymentId);
    if (
      !payment ||
      !reasonCodeId ||
      !pin ||
      !Number.isSafeInteger(parsedAmount) ||
      parsedAmount <= 0 ||
      parsedAmount > (payment.remainingRefundableMinor ?? 0)
    )
      return;
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
    if (!reasonCodeId || !pin || returnSelection.hasInvalidQuantity || returnItems.length === 0)
      return;
    await onReturn({ items: returnItems, reasonCodeId, note: note.trim() || null, pin });
    setPin('');
  }

  return (
    <AdminDialog
      open
      variant="sheet"
      title={mode === 'refund' ? 'Refund payment' : 'Return items'}
      description={
        mode === 'refund'
          ? 'Choose the payment and amount to refund, then confirm with your Admin PIN.'
          : 'This return records item valuation only; it does not refund or restock. Confirm with your Admin PIN. Financial settlement and inventory disposal/restock require separate authorized actions.'
      }
      onOpenChange={(open) => {
        if (!open && !refunding && !returning) onCancel();
      }}
    >
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

      {mode === 'refund' ? (
        <form
          className="admin-order-task-section is-compact"
          onSubmit={(event) => void submitRefund(event)}
        >
          <label className="admin-field">
            <span>Payment</span>
            <select
              value={paymentId}
              disabled={refunding || returning}
              onChange={(event) => {
                setPaymentId(event.target.value);
                const payment = refundablePayments.find(
                  (candidate) => candidate.id === event.target.value,
                );
                if (payment) setAmountMinor(String(payment.remainingRefundableMinor));
              }}
            >
              {refundablePayments.map((payment) => (
                <option key={payment.id} value={payment.id}>
                  {payment.methodLabel} · available {money(payment.remainingRefundableMinor ?? 0)}
                </option>
              ))}
            </select>
          </label>
          {(() => {
            const selected = refundablePayments.find((payment) => payment.id === paymentId);
            return selected ? (
              <p>
                Original allocation: {money(selected.allocatedMinor)} · Posted refunds:{' '}
                {money(selected.postedRefundMinor ?? 0)} · Pending approval:{' '}
                {money(selected.pendingRefundMinor ?? 0)} · Available to refund:{' '}
                {money(selected.remainingRefundableMinor ?? 0)}
              </p>
            ) : (
              <p role="status">No eligible refundable payment balance remains.</p>
            );
          })()}
          <label className="admin-field">
            <span>Refund amount (EGP)</span>
            <input
              type="number"
              min={0.01}
              max={
                (refundablePayments.find((payment) => payment.id === paymentId)
                  ?.remainingRefundableMinor ?? 0) / 100
              }
              step={0.01}
              value={Number(amountMinor) / 100 || ''}
              disabled={refunding || returning || !paymentId}
              onChange={(event) =>
                setAmountMinor(String(Math.round(Number(event.target.value) * 100)))
              }
            />
          </label>
          <button
            className="admin-primary-button"
            type="submit"
            disabled={
              refunding ||
              returning ||
              !reasonCodeId ||
              !paymentId ||
              !pin ||
              !Number.isSafeInteger(Number(amountMinor)) ||
              Number(amountMinor) <= 0 ||
              Number(amountMinor) >
                (refundablePayments.find((payment) => payment.id === paymentId)
                  ?.remainingRefundableMinor ?? 0)
            }
          >
            {refunding ? 'Refunding…' : 'Submit refund'}
          </button>
        </form>
      ) : null}

      {mode === 'return' ? (
        <form
          className="admin-order-task-section is-compact"
          onSubmit={(event) => void submitReturn(event)}
        >
          {order.items.map((item) => (
            <label className="admin-field" key={item.id}>
              <span>
                {item.productName} · purchased {item.quantity} · already returned{' '}
                {item.postedReturnQuantity ?? 0} · pending {item.pendingReturnQuantity ?? 0} ·
                remaining {item.remainingReturnableQuantity ?? 0}
              </span>
              <input
                aria-label={`Return quantity for ${item.productName}`}
                type="number"
                min={0}
                max={item.remainingReturnableQuantity ?? 0}
                step={1}
                value={returnQuantities[item.id] ?? '0'}
                disabled={refunding || returning || (item.remainingReturnableQuantity ?? 0) <= 0}
                onChange={(event) =>
                  setReturnQuantities((current) => ({ ...current, [item.id]: event.target.value }))
                }
              />
            </label>
          ))}
          <p>
            Estimated gross return item valuation: {money(returnEstimatedGrossMinor)}. Calculated
            from purchase-time base and modifier snapshots before order-level discounts, tax,
            delivery fees or service charges. This is not a refund or stock movement.
          </p>
          {returnSelection.hasInvalidQuantity ? (
            <p role="alert">
              A selected return quantity is invalid or exceeds the remaining quantity. Correct every
              item before submitting.
            </p>
          ) : null}
          <button
            className="admin-primary-button"
            type="submit"
            disabled={
              refunding ||
              returning ||
              !reasonCodeId ||
              !pin ||
              returnSelection.hasInvalidQuantity ||
              returnItems.length === 0
            }
          >
            {returning ? 'Returning…' : 'Return selected items'}
          </button>
        </form>
      ) : null}
      <button
        className="admin-secondary-button"
        type="button"
        disabled={refunding || returning}
        onClick={onCancel}
      >
        Cancel
      </button>
    </AdminDialog>
  );
}
