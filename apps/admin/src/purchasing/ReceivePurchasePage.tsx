import { useMemo, useState } from 'react';

import type { AdminPurchaseOrder } from '@tux/admin-contracts';

function micros(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed * 1_000_000);
}

function minor(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100);
}

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

  return (
    <form
      className="admin-card"
      onSubmit={(event) => {
        event.preventDefault();
        if (mode === 'receive') {
          const lines = eligible
            .map((line) => ({
              lineId: line.id,
              receivedPurchaseUnitsMicros: micros(quantities[line.id] ?? ''),
              purchaseUnitCostMinor: minor(costs[line.id] ?? ''),
            }))
            .filter((line) => line.receivedPurchaseUnitsMicros > 0);
          if (lines.length > 0) onReceive({ supplierReference: reference.trim() || null, lines });
          return;
        }
        const lines = eligible
          .map((line) => ({
            lineId: line.id,
            returnedPurchaseUnitsMicros: micros(quantities[line.id] ?? ''),
          }))
          .filter((line) => line.returnedPurchaseUnitsMicros > 0);
        if (lines.length > 0) onReturn({ supplierReference: reference.trim() || null, lines });
      }}
    >
      <h3>{mode === 'receive' ? 'Receive purchase' : 'Return purchase'}</h3>
      <label>
        {mode === 'receive' ? 'Supplier reference' : 'Return reference'}
        <input value={reference} onChange={(event) => setReference(event.currentTarget.value)} />
      </label>
      {eligible.map((line) => (
        <div className="admin-form-grid" key={line.id}>
          <label>
            {mode === 'receive'
              ? `Receive ${line.itemName} (${line.purchaseUnitLabel})`
              : `Return ${line.itemName} (${line.purchaseUnitLabel})`}
            <input
              aria-label={mode === 'receive' ? `Receive ${line.itemName}` : `Return ${line.itemName}`}
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
              {`Purchase-unit cost for ${line.itemName}`}
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
      <div className="admin-inventory-page-actions">
        <button className="admin-secondary-button" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="admin-primary-button" type="submit" disabled={pending}>
          {mode === 'receive' ? 'Post receipt' : 'Post return'}
        </button>
      </div>
    </form>
  );
}
