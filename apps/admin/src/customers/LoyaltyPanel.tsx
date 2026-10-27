import type {
  AdminCustomerDetail,
  AdminLoyaltyProgram,
  AdminReasonCodeConfiguration,
} from '@tux/admin-contracts';
import { useState, type FormEvent } from 'react';

function exactEgp(minor: number): string {
  if (!Number.isSafeInteger(minor)) return 'Unavailable';
  const cents = BigInt(minor);
  const abs = cents < 0n ? -cents : cents;
  return `${cents < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

export type LoyaltyAdjustmentInput = {
  pointsDelta: number;
  reasonCodeId: string;
  note: string | null;
};

function loyaltyEventLabel(eventType: string): string {
  const labels: Record<string, string> = {
    EARN: 'Points earned',
    REDEEM: 'Points redeemed',
    MANUAL_ADJUSTMENT: 'Manual adjustment',
    EXPIRY: 'Points expired',
    CANCEL_COMPENSATION: 'Cancellation adjustment',
    REFUND_COMPENSATION: 'Refund adjustment',
    RETURN_COMPENSATION: 'Return adjustment',
  };
  return labels[eventType] ?? 'Loyalty update';
}

export function LoyaltyPanel({
  customer,
  program,
  reasons,
  canManage,
  saving,
  onAdjust,
}: {
  customer: AdminCustomerDetail;
  program: AdminLoyaltyProgram | null;
  reasons: readonly AdminReasonCodeConfiguration[];
  canManage: boolean;
  saving: boolean;
  onAdjust(input: LoyaltyAdjustmentInput): void;
}) {
  const [pointsDelta, setPointsDelta] = useState('');
  const [reasonCodeId, setReasonCodeId] = useState('');
  const [note, setNote] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const parsed = Number(pointsDelta);
    if (!Number.isSafeInteger(parsed) || parsed === 0 || !reasonCodeId.trim()) {
      return;
    }
    onAdjust({
      pointsDelta: parsed,
      reasonCodeId: reasonCodeId.trim(),
      note: note.trim() || null,
    });
  }

  return (
    <section aria-label="Customer loyalty">
      <h3>Loyalty</h3>
      <p>
        <strong>{customer.loyaltyBalance} points</strong>
      </p>

      {program ? (
        <dl>
          <div>
            <dt>Status</dt>
            <dd>{program.enabled ? 'Enabled' : 'Disabled'}</dd>
          </div>
          <div>
            <dt>Earn rate</dt>
            <dd>{program.earnPointsPer100Minor} points / 1 EGP</dd>
          </div>
          <div>
            <dt>Redemption value</dt>
            <dd>1 point = EGP {exactEgp(program.redemptionMinorPerPoint)}</dd>
          </div>
          <div>
            <dt>Minimum redemption</dt>
            <dd>{program.minimumRedemptionPoints} points</dd>
          </div>
          <div>
            <dt>Point expiry</dt>
            <dd>
              {program.pointExpiryDays === null ? 'No expiry' : `${program.pointExpiryDays} days`}
            </dd>
          </div>
        </dl>
      ) : (
        <p>No loyalty program configured.</p>
      )}

      <h4>Points history</h4>
      {customer.loyaltyHistory.length === 0 ? (
        <p>No loyalty events.</p>
      ) : (
        <ul>
          {customer.loyaltyHistory.map((event) => (
            <li key={event.id}>
              <strong>{loyaltyEventLabel(event.eventType)}</strong> ·{' '}
              {event.pointsDelta > 0 ? '+' : ''}
              {event.pointsDelta}
              {event.note ? ` · ${event.note}` : ''}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <form onSubmit={submit}>
          <h4>Manual adjustment</h4>
          <label className="admin-field">
            <span>Points delta</span>
            <input
              inputMode="numeric"
              disabled={saving}
              value={pointsDelta}
              onChange={(event) => setPointsDelta(event.target.value)}
            />
          </label>
          <label className="admin-field">
            <span>Reason</span>
            <select
              value={reasonCodeId}
              disabled={saving}
              onChange={(event) => setReasonCodeId(event.target.value)}
              required
            >
              <option value="">Choose a reason</option>
              {reasons.map((reason) => (
                <option key={reason.id} value={reason.id}>
                  {reason.label}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-field">
            <span>Note</span>
            <textarea disabled={saving} value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
          <button className="admin-primary-button" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Adjust points'}
          </button>
        </form>
      ) : null}
    </section>
  );
}
