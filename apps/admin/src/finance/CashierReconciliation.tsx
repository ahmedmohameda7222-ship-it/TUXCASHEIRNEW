import { useState } from 'react';

import { InlineError } from '../components/feedback/AdminStates';
import { AdminDialog } from '../components/overlay/AdminDialog';
import { formatEgp, parseEgpMinor } from './money';
import { useFinanceOperations } from './useFinanceOperations';

export function CashierReconciliation({
  shopId,
  businessDayId,
  open,
  onClose,
}: {
  shopId: string;
  businessDayId: string;
  open: boolean;
  onClose(): void;
}) {
  const finance = useFinanceOperations(shopId, businessDayId);
  const [workerId, setWorkerId] = useState('');
  const [actual, setActual] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const workers = finance.cashierQuery.data?.workers ?? [];
  const posted = finance.cashierQuery.data?.reconciliations ?? [];
  const selectedCashier = finance.cashierQuery.data?.cashiers?.find(
    (c) => c.cashierWorkerId === workerId,
  );
  const remaining = workers.filter(
    (worker) => !posted.some((recon) => recon.cashier_worker_id === worker.id),
  );
  function submit() {
    try {
      if (!remaining.some((worker) => worker.id === workerId)) {
        throw new Error('Choose an unreconciled cashier.');
      }
      const actualMinor = parseEgpMinor(actual);
      if (actualMinor < 0) throw new Error('Actual cash cannot be negative.');
      finance.command.mutate(
        {
          draft: {
            type: 'finance.cashier.reconcile',
            shopId,
            businessDayId,
            cashierWorkerId: workerId,
            actualMinor,
            reason: reason.trim() || null,
          },
        },
        {
          onSuccess: () => {
            onClose();
            setWorkerId('');
            setActual('');
            setReason('');
            setError(null);
          },
        },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid cash count');
    }
  }
  return (
    <AdminDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Cashier cash count"
      variant="sheet"
      description="The server calculates cash sales and separately includes recorded drawer movements. Unrecorded opening cash cannot be inferred."
      footer={
        <>
          <button type="button" className="admin-secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="admin-primary-button"
            disabled={finance.command.isPending || remaining.length === 0}
            onClick={submit}
          >
            {finance.command.isPending ? 'Recording…' : 'Record count'}
          </button>
        </>
      }
    >
      <div className="tux-finance-form">
        <label>
          Cashier
          <select value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
            <option value="">Choose cashier</option>
            {remaining.map((worker) => (
              <option key={worker.id} value={worker.id}>
                {worker.display_name}
              </option>
            ))}
          </select>
        </label>
        {selectedCashier ? (
          <div className="tux-finance-attention" role="status">
            <p>
              Cash sales after posted refunds:{' '}
              {formatEgp(selectedCashier.cashSalesExpectationMinor)}
            </p>
            <p>Recorded drawer movements: {formatEgp(selectedCashier.recordedCashMovementMinor)}</p>
            <strong>
              Expected from recorded facts: {formatEgp(selectedCashier.expectedMinor)}
            </strong>
            {!selectedCashier.openingFloatRecorded ? (
              <p>
                No recorded opening float is available for this cashier. The recorded expectation is
                not a verified physical opening balance.
              </p>
            ) : null}
          </div>
        ) : null}
        <label>
          Actual counted cash (EGP)
          <input
            value={actual}
            inputMode="decimal"
            onChange={(e) => setActual(e.target.value)}
            placeholder={formatEgp(0)}
          />
        </label>
        <label>
          Variance reason, if different
          <textarea
            rows={2}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {error ? <InlineError>{error}</InlineError> : null}
        {finance.command.error ? (
          <InlineError>
            {finance.command.error instanceof Error
              ? finance.command.error.message
              : 'Cash count failed'}
          </InlineError>
        ) : null}
      </div>
    </AdminDialog>
  );
}
