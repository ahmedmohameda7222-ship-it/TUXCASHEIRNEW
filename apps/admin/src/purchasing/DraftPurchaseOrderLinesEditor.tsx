import type { AdminPurchaseOrder, AdminPurchasingInventoryItem } from '@tux/admin-contracts';
import { useRef, useState, type FormEvent } from 'react';
import {
  calculatePurchaseOrderSubtotalMinor,
  formatPurchaseMicros,
  parsePurchaseDecimalMicros,
  parsePurchaseMoneyMinor,
  validatePurchaseOrderLines,
} from './purchaseOrderDraft';

type DraftLine = {
  key: number;
  inventoryItemId: string;
  purchaseUnitLabel: string;
  quantity: string;
  cost: string;
};

function lineFor(item: AdminPurchasingInventoryItem | undefined, key: number): DraftLine {
  return {
    key,
    inventoryItemId: item?.id ?? '',
    purchaseUnitLabel: item?.purchaseUnits[0]?.label ?? '',
    quantity: '',
    cost: '',
  };
}

export function DraftPurchaseOrderLinesEditor({
  order,
  inventoryItems,
  pending,
  onSave,
  onCancel,
}: {
  order: AdminPurchaseOrder;
  inventoryItems: readonly AdminPurchasingInventoryItem[];
  pending: boolean;
  onSave(
    lines: readonly {
      inventoryItemId: string;
      purchaseUnitLabel: string;
      orderedPurchaseUnitsMicros: number;
      expectedPurchaseUnitCostMinor: number;
    }[],
    onSuccess: () => void,
  ): void;
  onCancel(): void;
}) {
  const nextKey = useRef(order.lines.length + 1);
  const [rows, setRows] = useState<DraftLine[]>(() =>
    order.lines.map((line, index) => ({
      key: index,
      inventoryItemId: line.inventoryItemId,
      purchaseUnitLabel: line.purchaseUnitLabel,
      quantity: formatPurchaseMicros(line.orderedPurchaseUnitsMicros),
      cost: formatPurchaseMicros(line.expectedPurchaseUnitCostMinor * 10_000),
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const prepared = rows.map((line) => ({
    inventoryItemId: line.inventoryItemId,
    purchaseUnitLabel: line.purchaseUnitLabel,
    orderedPurchaseUnitsMicros: parsePurchaseDecimalMicros(line.quantity) ?? 0,
    expectedPurchaseUnitCostMinor: parsePurchaseMoneyMinor(line.cost) ?? -1,
  }));
  const validationError = validatePurchaseOrderLines(prepared, inventoryItems);

  function update(key: number, changes: Partial<DraftLine>) {
    setRows((current) =>
      current.map((line) => (line.key === key ? { ...line, ...changes } : line)),
    );
    setError(null);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (validationError) {
      setError(validationError);
      return;
    }
    try {
      calculatePurchaseOrderSubtotalMinor(prepared);
    } catch {
      setError('Purchase order subtotal is too large.');
      return;
    }
    onSave(prepared, onCancel);
  }

  if (order.status !== 'DRAFT') return null;

  return (
    <form
      className="admin-form-grid"
      aria-label="Edit draft purchase order lines"
      onSubmit={submit}
    >
      <h3>Draft purchase order lines</h3>
      <p>These definitions can be corrected only before ordering or receiving.</p>
      {rows.map((row, index) => {
        const item = inventoryItems.find((candidate) => candidate.id === row.inventoryItemId);
        return (
          <fieldset className="admin-form-grid" key={row.key}>
            <legend>Line {index + 1}</legend>
            <label>
              Inventory item
              <select
                value={row.inventoryItemId}
                disabled={pending}
                onChange={(event) => {
                  const selected = inventoryItems.find(
                    (candidate) => candidate.id === event.currentTarget.value,
                  );
                  update(row.key, {
                    inventoryItemId: selected?.id ?? '',
                    purchaseUnitLabel: selected?.purchaseUnits[0]?.label ?? '',
                  });
                }}
              >
                {inventoryItems.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Purchase unit
              <select
                value={row.purchaseUnitLabel}
                disabled={pending}
                onChange={(event) =>
                  update(row.key, { purchaseUnitLabel: event.currentTarget.value })
                }
              >
                {(item?.purchaseUnits ?? []).map((unit) => (
                  <option key={unit.label} value={unit.label}>
                    {unit.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Quantity
              <input
                inputMode="decimal"
                value={row.quantity}
                required
                disabled={pending}
                onChange={(event) => update(row.key, { quantity: event.currentTarget.value })}
              />
            </label>
            <label>
              Expected unit cost (EGP)
              <input
                inputMode="decimal"
                value={row.cost}
                required
                disabled={pending}
                onChange={(event) => update(row.key, { cost: event.currentTarget.value })}
              />
            </label>
            {rows.length > 1 ? (
              <button
                className="admin-secondary-button"
                type="button"
                disabled={pending}
                onClick={() =>
                  setRows((current) => current.filter((entry) => entry.key !== row.key))
                }
              >
                Remove line {index + 1}
              </button>
            ) : null}
          </fieldset>
        );
      })}
      <button
        className="admin-secondary-button"
        type="button"
        disabled={pending || rows.length >= 500}
        onClick={() =>
          setRows((current) => [...current, lineFor(inventoryItems[0], nextKey.current++)])
        }
      >
        Add line
      </button>
      {error || validationError ? <p role="alert">{error ?? validationError}</p> : null}
      <div className="admin-inventory-page-actions">
        <button
          className="admin-primary-button"
          type="submit"
          disabled={pending || inventoryItems.length === 0}
        >
          Save draft lines
        </button>
        <button
          className="admin-secondary-button"
          type="button"
          disabled={pending}
          onClick={onCancel}
        >
          Cancel editing
        </button>
      </div>
    </form>
  );
}
