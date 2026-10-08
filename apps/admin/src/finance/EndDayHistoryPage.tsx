import { useState } from 'react';

import { InlineError, LoadingState } from '../components/feedback/AdminStates';
import { AdminDialog } from '../components/overlay/AdminDialog';
import { formatEgp, parseEgpMinor } from './money';
import { useFinanceOperations } from './useFinanceOperations';

export function EndDayHistoryPage({ shopId, canAdjust }: { shopId: string; canAdjust: boolean }) {
  const operations = useFinanceOperations(shopId, undefined);
  const history = operations.dayHistoryQuery.data;
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [validation, setValidation] = useState<string | null>(null);

  function adjust() {
    if (!snapshotId) return;
    try {
      const amountMinor = parseEgpMinor(amount);
      if (amountMinor === 0) throw new Error('Adjustment cannot be zero.');
      if (!reason.trim()) throw new Error('Explain why the adjustment is necessary.');
      if (!/^\d{4,12}$/.test(pin)) throw new Error('PIN re-authentication is required.');
      operations.command.mutate(
        {
          draft: {
            type: 'finance.snapshot.adjust',
            shopId,
            snapshotId,
            amountMinor,
            reason: reason.trim(),
          },
          reauthPin: pin,
        },
        {
          onSuccess: () => {
            setSnapshotId(null);
            setAmount('');
            setReason('');
            setPin('');
            setValidation(null);
          },
        },
      );
    } catch (error) {
      setValidation(error instanceof Error ? error.message : 'Invalid adjustment');
    }
  }
  return (
    <section aria-label="Immutable financial Z history" className="tux-finance-day-history">
      <h2>Financial Z history</h2>
      {operations.dayHistoryQuery.isLoading ? (
        <LoadingState title="Loading finalized days" />
      ) : null}
      {history?.snapshots.length === 0 ? <p>No financial Z snapshots finalized yet.</p> : null}
      <ul className="tux-finance-ledger-list">
        {(history?.snapshots ?? []).map((snapshot) => {
          const adjustments = (history?.adjustments ?? []).filter(
            (adj) => adj.snapshot_id === snapshot.id,
          );
          const original = snapshot.snapshot.estimatedOperatingProfitMinor;
          const adjustTotal = adjustments.reduce((total, adj) => total + adj.amount_minor, 0);
          return (
            <li key={snapshot.id} className="tux-finance-history-record">
              <div>
                <strong>
                  {new Date(snapshot.finalized_at).toLocaleString('en-EG', {
                    timeZone: 'Africa/Cairo',
                  })}
                </strong>
                <small>
                  Operations Business Day:{' '}
                  {new Date(snapshot.snapshot.startedAt).toLocaleDateString('en-EG')}
                </small>
                <span>Original net sales: {formatEgp(snapshot.snapshot.netSalesMinor)}</span>
                <span>
                  Original operating estimate:{' '}
                  {original === null ? 'Cost data incomplete' : formatEgp(original)}
                </span>
                <span>Posted adjustments: {formatEgp(adjustTotal)}</span>
                <strong>
                  Adjusted estimate:{' '}
                  {original === null ? 'Unavailable' : formatEgp(original + adjustTotal)}
                </strong>
                {adjustments.length > 0 ? (
                  <ul>
                    {adjustments.map((entry) => (
                      <li key={entry.id}>
                        {entry.reason}: {formatEgp(entry.amount_minor)}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              {canAdjust ? (
                <button
                  type="button"
                  className="admin-secondary-button"
                  onClick={() => setSnapshotId(snapshot.id)}
                >
                  Append correction
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <AdminDialog
        open={snapshotId !== null}
        title="Append financial correction"
        description="The original finalized snapshot cannot be edited. Your reason and adjustment are added as an immutable event."
        variant="sheet"
        onOpenChange={(open) => {
          if (!open) {
            setSnapshotId(null);
            setPin('');
          }
        }}
        footer={
          <>
            <button
              type="button"
              className="admin-secondary-button"
              onClick={() => {
                setSnapshotId(null);
                setPin('');
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="admin-primary-button"
              disabled={operations.command.isPending}
              onClick={adjust}
            >
              Append correction
            </button>
          </>
        }
      >
        <div className="tux-finance-form">
          <label>
            Adjustment amount (EGP, signed)
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label>
            Reason
            <textarea
              rows={3}
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <label>
            PIN confirmation
            <input
              type="password"
              autoComplete="off"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
            />
          </label>
          {validation ? <InlineError>{validation}</InlineError> : null}
          {operations.command.error ? (
            <InlineError>
              {operations.command.error instanceof Error
                ? operations.command.error.message
                : 'Adjustment failed'}
            </InlineError>
          ) : null}
        </div>
      </AdminDialog>
    </section>
  );
}
