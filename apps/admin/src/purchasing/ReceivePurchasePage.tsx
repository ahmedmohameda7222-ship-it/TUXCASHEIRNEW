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
    lines: readonly { lineId: string; receivedBaseMicros: number; unitCostMinor: number }[];
  }): void;
  onReturn(input: {
    supplierReference: string | null;
    lines: readonly { lineId: string; returnedBaseMicros: number; unitCostMinor: number }[];
  }): void;
}) {
  const eligible = useMemo(
    () =>
      order.lines.filter((line) =>
        mode === 'receive'
          ? line.remainingBaseMicros > 0
          : line.receivedBaseMicros - line.returnedBaseMicros > 0,
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
              receivedBaseMicros: micros(quantities[line.id] ?? ''),
              unitCostMinor: minor(costs[line.id] ?? ''),
            }))
            .filter((line) => line.receivedBaseMicros > 0);
          if (lines.length > 0) onReceive({ supplierReference: reference.trim() || null, lines });
          return;
        }
        const lines = eligible
          .map((line) => ({
            lineId: line.id,
            returnedBaseMicros: micros(quantities[line.id] ?? ''),
            unitCostMinor: minor(costs[line.id] ?? ''),
          }))
          .filter((line) => line.returnedBaseMicros > 0);
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
            {mode === 'receive' ? `Receive ${line.itemName}` : `Return ${line.itemName}`}
            <input
              inputMode="decimal"
              value={quantities[line.id] ?? ''}
              onChange={(event) =>
                setQuantities((current) => ({ ...current, [line.id]: event.currentTarget.value }))
              }
            />
          </label>
          <label>
            {mode === 'receive'
              ? `Unit cost for ${line.itemName}`
              : `Return unit cost for ${line.itemName}`}
            <input
              inputMode="decimal"
              value={costs[line.id] ?? ''}
              onChange={(event) =>
                setCosts((current) => ({ ...current, [line.id]: event.currentTarget.value }))
              }
            />
          </label>
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
