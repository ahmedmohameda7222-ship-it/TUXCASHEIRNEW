import { useMemo, useState } from 'react';

import type {
  AdminPurchaseOrder,
  AdminPurchasingInventoryItem,
  AdminSupplier,
} from '@tux/admin-contracts';
import { AdminDialog } from '../components/overlay/AdminDialog';

function statusLabel(status: AdminPurchaseOrder['status']): string {
  return status
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/^./, (letter) => letter.toUpperCase());
}

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
  const firstItem = inventoryItems[0]?.id ?? '';
  const [supplierId, setSupplierId] = useState(firstSupplier);
  const [itemId, setItemId] = useState(firstItem);
  const [reference, setReference] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [quantity, setQuantity] = useState('');
  const [purchaseUnit, setPurchaseUnit] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const selectedSupplierId = activeSuppliers.some((supplier) => supplier.id === supplierId)
    ? supplierId
    : firstSupplier;
  const selectedItemId = inventoryItems.some((item) => item.id === itemId) ? itemId : firstItem;
  const unitLabel = useMemo(
    () => inventoryItems.find((item) => item.id === selectedItemId)?.unitLabel ?? 'unit',
    [inventoryItems, selectedItemId],
  );

  return (
    <section aria-labelledby="purchase-orders-heading">
      <div className="admin-catalog-editor__section-heading">
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
          title="New purchase order"
          description="Choose a supplier and add the first item."
          onOpenChange={(open) => {
            if (!pending) setCreateOpen(open);
          }}
        >
          <form
            className="admin-form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              const orderedPurchaseUnitsMicros = baseMicros(quantity);
              if (!selectedSupplierId || !selectedItemId || orderedPurchaseUnitsMicros <= 0) return;
              onCreate(
                {
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
                },
                () => {
                  setReference('');
                  setExpectedDate('');
                  setQuantity('');
                  setPurchaseUnit('');
                  setUnitCost('');
                  setCreateOpen(false);
                },
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
              Expected cost per purchase unit (EGP)
              <input
                inputMode="decimal"
                value={unitCost}
                onChange={(event) => setUnitCost(event.currentTarget.value)}
              />
            </label>
            <button
              className="admin-primary-button"
              type="submit"
              disabled={pending || !selectedSupplierId}
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
