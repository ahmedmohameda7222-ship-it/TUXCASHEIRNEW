import { useMemo, useState } from 'react';

import type { AdminPurchaseOrder } from '@tux/admin-contracts';
import { AdminDialog } from '../components/overlay/AdminDialog';
import { formatPurchaseMicros } from './purchaseOrderDraft';
import { parseReceiptLines, parseReturnLines } from './receivePurchaseValidation';

export function ReceivePurchasePage({
  order,
  mode,
  pending,
  onCancel,
  onReceive,
  onReturn,
}: {
  order: AdminPurchaseOrder;
  mode: 'receive' | 'return';
  pending: boolean;
  onCancel(): void;
  onReceive(input: {
    supplierReference: string | null;
    lines: readonly {
      lineId: string;
      receivedPurchaseUnitsMicros: number;
      purchaseUnitCostMinor: number;
    }[];
  }): void;
  onReturn(input: {
    supplierReference: string | null;
    lines: readonly { lineId: string; returnedPurchaseUnitsMicros: number }[];
  }): void;
}) {
  const eligible = useMemo(
    () =>
      order.lines.filter((line) =>
        mode === 'receive'
          ? line.orderedPurchaseUnitsMicros - line.receivedPurchaseUnitsMicros > 0
          : line.receivedPurchaseUnitsMicros - line.returnedPurchaseUnitsMicros > 0,
      ),
    [mode, order.lines],
  );
  const [reference, setReference] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [validationError, setValidationError] = useState<string | null>(null);

  return (
    <AdminDialog
      open
      variant="sheet"
      title={mode === 'receive' ? 'Receive purchase' : 'Return purchase'}
      description={
        mode === 'receive'
          ? 'Record quantities and purchase-unit costs from this supplier delivery.'
          : 'Record quantities being returned to the supplier.'
      }
      onOpenChange={(open) => {
        if (!open && !pending) onCancel();
      }}
    >
      <form
        className="admin-form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          if (mode === 'receive') {
            const result = parseReceiptLines(eligible, quantities, costs);
            if (!result.ok) {
              setValidationError(result.error);
              return;
            }
            setValidationError(null);
            onReceive({ supplierReference: reference.trim() || null, lines: result.lines });
            return;
          }
          const result = parseReturnLines(eligible, quantities);
          if (!result.ok) {
            setValidationError(result.error);
            return;
          }
          setValidationError(null);
          onReturn({ supplierReference: reference.trim() || null, lines: result.lines });
        }}
      >
        <label>
          {mode === 'receive' ? 'Supplier reference' : 'Return reference'}
          <input value={reference} onChange={(event) => setReference(event.currentTarget.value)} />
        </label>
        {validationError ? <p role="alert">{validationError}</p> : null}
        {mode === 'receive' ? (
          <p className="admin-inventory-muted">A positive cost is required for every received line. Free goods must be handled through an explicitly authorized process.</p>
        ) : null}
        {eligible.map((line) => (
          <div className="admin-form-grid" key={line.id}>
            <p className="admin-inventory-muted">Remaining: {formatPurchaseMicros(mode === 'receive' ? line.orderedPurchaseUnitsMicros - line.receivedPurchaseUnitsMicros : line.receivedPurchaseUnitsMicros - line.returnedPurchaseUnitsMicros)} {line.purchaseUnitLabel}</p>
            <label>
              {mode === 'receive'
                ? `Receive ${line.itemName} (${line.purchaseUnitLabel})`
                : `Return ${line.itemName} (${line.purchaseUnitLabel})`}
              <input
                aria-label={
                  mode === 'receive' ? `Receive ${line.itemName}` : `Return ${line.itemName}`
                }
                inputMode="decimal"
                value={quantities[line.id] ?? ''}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setQuantities((current) => ({ ...current, [line.id]: value }));
                }}
              />
            </label>
            {mode === 'receive' ? (
              <label>
                {`Purchase-unit cost for ${line.itemName} (EGP)`}
                <input
                  aria-label={`Unit cost for ${line.itemName}`}
                  inputMode="decimal"
                  value={costs[line.id] ?? ''}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setCosts((current) => ({ ...current, [line.id]: value }));
                  }}
                />
              </label>
            ) : null}
          </div>
        ))}
        <div className="admin-purchasing-page-actions">
          <button
            className="admin-secondary-button"
            type="button"
            disabled={pending}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="admin-primary-button"
            type="submit"
            disabled={pending || eligible.length === 0}
          >
            {pending ? 'Saving…' : mode === 'receive' ? 'Post receipt' : 'Post return'}
          </button>
        </div>
      </form>
    </AdminDialog>
  );
}
