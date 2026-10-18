import type {
  AdminPurchaseOrder,
  AdminPurchasingInventoryItem,
  AdminSupplier,
} from '@tux/admin-contracts';
import { useMemo, useRef, useState } from 'react';

import { AdminDialog } from '../components/overlay/AdminDialog';
import {
  calculatePurchaseOrderSubtotalMinor,
  parsePurchaseDecimalMicros,
  parsePurchaseMoneyMinor,
  validatePurchaseOrderLines,
} from './purchaseOrderDraft';

function statusLabel(status: AdminPurchaseOrder['status']): string {
  return status
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/^./, (letter) => letter.toUpperCase());
}

type DraftLine = {
  key: number;
  inventoryItemId: string;
  purchaseUnitLabel: string;
  quantity: string;
  unitCost: string;
};

function newLine(key: number, items: readonly AdminPurchasingInventoryItem[]): DraftLine {
  const first = items[0];
  return {
    key,
    inventoryItemId: first?.id ?? '',
    purchaseUnitLabel: first?.purchaseUnits[0]?.label ?? first?.unitLabel ?? '',
    quantity: '',
    unitCost: '',
  };
}

function formatEgpMinor(minor: number): string {
  const amount = BigInt(minor);
  return `${amount / 100n}.${String(amount % 100n).padStart(2, '0')}`;
}

export function PurchaseOrdersPage({
  purchaseOrders,
  suppliers,
  inventoryItems,
  selectedId,
  canManage,
  pending,
  onSelect,
  onCreate,
}: {
  purchaseOrders: readonly AdminPurchaseOrder[];
  suppliers: readonly AdminSupplier[];
  inventoryItems: readonly AdminPurchasingInventoryItem[];
  selectedId: string | null;
  canManage: boolean;
  pending: boolean;
  onSelect(id: string): void;
  onCreate(
    input: {
      supplierId: string;
      reference: string | null;
      expectedDeliveryDate: string | null;
      lines: readonly {
        inventoryItemId: string;
        purchaseUnitLabel: string;
        orderedPurchaseUnitsMicros: number;
        expectedPurchaseUnitCostMinor: number;
      }[];
    },
    onSuccess: () => void,
  ): void;
}) {
  const activeSuppliers = useMemo(
    () => suppliers.filter((supplier) => supplier.active),
    [suppliers],
  );
  const firstSupplier = activeSuppliers[0]?.id ?? '';
  const [supplierId, setSupplierId] = useState(firstSupplier);
  const [reference, setReference] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const nextKey = useRef(2);
  const [lines, setLines] = useState<DraftLine[]>(() => [newLine(1, inventoryItems)]);
  const [formError, setFormError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const selectedSupplierId = activeSuppliers.some((supplier) => supplier.id === supplierId)
    ? supplierId
    : firstSupplier;

  const preparedLines = lines.map((line) => ({
    inventoryItemId: line.inventoryItemId,
    purchaseUnitLabel: line.purchaseUnitLabel,
    orderedPurchaseUnitsMicros: parsePurchaseDecimalMicros(line.quantity) ?? 0,
    expectedPurchaseUnitCostMinor: parsePurchaseMoneyMinor(line.unitCost) ?? -1,
  }));
  const lineError = validatePurchaseOrderLines(preparedLines, inventoryItems);
  const subtotal =
    lineError === null
      ? (() => {
          try {
            return calculatePurchaseOrderSubtotalMinor(preparedLines);
          } catch {
            return null;
          }
        })()
      : null;

  function resetForm() {
    setReference('');
    setExpectedDate('');
    setLines([newLine(nextKey.current++, inventoryItems)]);
    setFormError(null);
    setCreateOpen(false);
  }

  function updateLine(key: number, changes: Partial<DraftLine>) {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...changes } : line)),
    );
    setFormError(null);
  }

  return (
    <section aria-labelledby="purchase-orders-heading">
      <div className="admin-section-heading">
        <h2 id="purchase-orders-heading">Purchase orders</h2>
        {canManage ? (
          <button
            className="admin-primary-button"
            type="button"
            onClick={() => setCreateOpen(true)}
          >
            New purchase order
          </button>
        ) : null}
      </div>
      <div className="admin-record-list">
        {purchaseOrders.map((order) => (
          <button
            className={
              selectedId === order.id
                ? 'admin-record-row admin-record-row--button is-selected'
                : 'admin-record-row admin-record-row--button'
            }
            type="button"
            key={order.id}
            onClick={() => onSelect(order.id)}
          >
            <span>
              <strong>{order.reference ?? `Purchase order · ${order.supplierName}`}</strong>
              <small>{order.supplierName}</small>
            </span>
            <span>{statusLabel(order.status)}</span>
          </button>
        ))}
      </div>
      {canManage ? (
        <AdminDialog
          open={createOpen}
          variant="sheet"
          size="wide"
          title="New purchase order"
          description="Choose a supplier and add one or more purchase-order lines."
          onOpenChange={(open) => {
            if (!pending) setCreateOpen(open);
          }}
        >
          <form
            className="admin-form-grid admin-po-builder"
            onSubmit={(event) => {
              event.preventDefault();
              const error = !selectedSupplierId
                ? 'Select a supplier.'
                : (lineError ?? (subtotal === null ? 'Order subtotal is too large.' : null));
              if (error) {
                setFormError(error);
                return;
              }
              onCreate(
                {
                  supplierId: selectedSupplierId,
                  reference: reference.trim() || null,
                  expectedDeliveryDate: expectedDate || null,
                  lines: preparedLines,
                },
                resetForm,
              );
            }}
          >
            <label>
              Supplier
              <select
                value={selectedSupplierId}
                onChange={(event) => setSupplierId(event.currentTarget.value)}
              >
                {activeSuppliers.map((supplier) => (
                  <option value={supplier.id} key={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Reference
              <input
                value={reference}
                onChange={(event) => setReference(event.currentTarget.value)}
              />
            </label>
            <label>
              Expected delivery
              <input
                type="date"
                value={expectedDate}
                onChange={(event) => setExpectedDate(event.currentTarget.value)}
              />
            </label>
            {lines.map((line, index) => {
              const item = inventoryItems.find(
                (candidate) => candidate.id === line.inventoryItemId,
              );
              const units = item?.purchaseUnits ?? [];
              return (
                <fieldset className="admin-form-grid" key={line.key}>
                  <legend>Line {index + 1}</legend>
                  <label>
                    Inventory item
                    <select
                      value={line.inventoryItemId}
                      onChange={(event) => {
                        const selected = inventoryItems.find(
                          (candidate) => candidate.id === event.currentTarget.value,
                        );
                        updateLine(line.key, {
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
                      value={line.purchaseUnitLabel}
                      onChange={(event) =>
                        updateLine(line.key, { purchaseUnitLabel: event.currentTarget.value })
                      }
                    >
                      {units.map((unit) => (
                        <option key={unit.label} value={unit.label}>
                          {unit.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Quantity (purchase units)
                    <input
                      inputMode="decimal"
                      required
                      value={line.quantity}
                      onChange={(event) =>
                        updateLine(line.key, { quantity: event.currentTarget.value })
                      }
                    />
                  </label>
                  <label>
                    Expected cost per purchase unit (EGP)
                    <input
                      inputMode="decimal"
                      required
                      value={line.unitCost}
                      onChange={(event) =>
                        updateLine(line.key, { unitCost: event.currentTarget.value })
                      }
                    />
                  </label>
                  {lines.length > 1 ? (
                    <button
                      className="admin-secondary-button"
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        setLines((current) =>
                          current.filter((candidate) => candidate.key !== line.key),
                        );
                        setFormError(null);
                      }}
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
              disabled={pending || lines.length >= 500 || inventoryItems.length === 0}
              onClick={() => {
                setLines((current) => [...current, newLine(nextKey.current++, inventoryItems)]);
                setFormError(null);
              }}
            >
              Add line
            </button>
            {formError ? <p role="alert">{formError}</p> : null}
            {subtotal !== null ? <p>Expected subtotal: {formatEgpMinor(subtotal)} EGP</p> : null}
            <button
              className="admin-primary-button"
              type="submit"
              disabled={pending || !selectedSupplierId || inventoryItems.length === 0}
            >
              Create purchase order
            </button>
            <button
              className="admin-secondary-button"
              type="button"
              disabled={pending}
              onClick={() => setCreateOpen(false)}
            >
              Cancel
            </button>
          </form>
        </AdminDialog>
      ) : null}
    </section>
  );
}
