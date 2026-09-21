import { useMemo, useState } from 'react';

import type {
  AdminPurchaseOrder,
  AdminPurchasingInventoryItem,
  AdminSupplier,
} from '@tux/admin-contracts';

function baseMicros(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed * 1_000_000);
}

function minorUnits(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100);
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
  onCreate(input: {
    supplierId: string;
    reference: string | null;
    expectedDeliveryDate: string | null;
    lines: readonly {
      inventoryItemId: string;
      purchaseUnitLabel: string;
      orderedPurchaseUnitsMicros: number;
      expectedPurchaseUnitCostMinor: number;
    }[];
  }): void;
}) {
  const firstSupplier = suppliers[0]?.id ?? '';
  const firstItem = inventoryItems[0]?.id ?? '';
  const [supplierId, setSupplierId] = useState(firstSupplier);
  const [itemId, setItemId] = useState(firstItem);
  const [reference, setReference] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [quantity, setQuantity] = useState('');
  const [purchaseUnit, setPurchaseUnit] = useState('');
  const [unitCost, setUnitCost] = useState('');

  const selectedSupplierId = suppliers.some((supplier) => supplier.id === supplierId)
    ? supplierId
    : firstSupplier;
  const selectedItemId = inventoryItems.some((item) => item.id === itemId)
    ? itemId
    : firstItem;
  const unitLabel = useMemo(
    () => inventoryItems.find((item) => item.id === selectedItemId)?.unitLabel ?? 'unit',
    [inventoryItems, selectedItemId],
  );

  return (
    <section aria-labelledby="purchase-orders-heading">
      <h2 id="purchase-orders-heading">Purchase orders</h2>
      <div className="admin-inventory-list">
        {purchaseOrders.map((order) => (
          <button
            className={
              selectedId === order.id ? 'admin-inventory-row is-selected' : 'admin-inventory-row'
            }
            type="button"
            key={order.id}
            onClick={() => onSelect(order.id)}
          >
            <span>
              <strong>{order.reference ?? order.id.slice(0, 8)}</strong>
              <small>{order.supplierName}</small>
            </span>
            <span>{order.status.replaceAll('_', ' ')}</span>
          </button>
        ))}
      </div>
      {canManage ? (
        <form
          className="admin-form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            const orderedPurchaseUnitsMicros = baseMicros(quantity);
            if (!selectedSupplierId || !selectedItemId || orderedPurchaseUnitsMicros <= 0) return;
            onCreate({
              supplierId: selectedSupplierId,
              reference: reference.trim() || null,
              expectedDeliveryDate: expectedDate || null,
              lines: [
                {
                  inventoryItemId: selectedItemId,
                  purchaseUnitLabel: purchaseUnit.trim() || unitLabel,
                  orderedPurchaseUnitsMicros,
                  expectedPurchaseUnitCostMinor: minorUnits(unitCost),
                },
              ],
            });
          }}
        >
          <label>
            Supplier
            <select
              value={selectedSupplierId}
              onChange={(event) => setSupplierId(event.currentTarget.value)}
            >
              {suppliers.map((supplier) => (
                <option value={supplier.id} key={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Inventory item
            <select
              value={selectedItemId}
              onChange={(event) => setItemId(event.currentTarget.value)}
            >
              {inventoryItems.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
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
          <label>
            Order quantity (purchase units)
            <input
              inputMode="decimal"
              value={quantity}
              onChange={(event) => setQuantity(event.currentTarget.value)}
            />
          </label>
          <label>
            Purchase unit
            <input
              value={purchaseUnit}
              placeholder={unitLabel}
              onChange={(event) => setPurchaseUnit(event.currentTarget.value)}
            />
          </label>
          <label>
            Expected purchase-unit cost
            <input
              inputMode="decimal"
              value={unitCost}
              onChange={(event) => setUnitCost(event.currentTarget.value)}
            />
          </label>
          <button className="admin-secondary-button" type="submit" disabled={pending}>
            Create purchase order
          </button>
        </form>
      ) : null}
    </section>
  );
}
