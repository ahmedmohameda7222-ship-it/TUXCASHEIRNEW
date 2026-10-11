import type { AdminPurchaseOrder, AdminPurchasingInventoryItem } from '@tux/admin-contracts';
import { DraftPurchaseOrderLinesEditor } from './DraftPurchaseOrderLinesEditor';
import { useEffect, useState } from 'react';

function units(value: number, unitLabel: string): string {
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(value / 1_000_000)} ${unitLabel}`;
}

function statusLabel(status: AdminPurchaseOrder['status']): string {
  return status
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/^./, (letter) => letter.toUpperCase());
}

export function PurchaseOrderPage({
  order,
  canManage,
  canReceive,
  ordering,
  updating,
  onUpdate,
  inventoryItems = [],
  replacing = false,
  onReplaceLines,
  cancelling,
  onCancel,
  onOrder,
  onReceive,
  onReturn,
}: {
  order: AdminPurchaseOrder;
  canManage: boolean;
  canReceive: boolean;
  ordering: boolean;
  updating: boolean;
  inventoryItems?: readonly AdminPurchasingInventoryItem[];
  replacing?: boolean;
  onReplaceLines?(
    lines: readonly {
      inventoryItemId: string;
      purchaseUnitLabel: string;
      orderedPurchaseUnitsMicros: number;
      expectedPurchaseUnitCostMinor: number;
    }[],
    onSuccess: () => void,
  ): void;
  onUpdate(
    input: { reference: string | null; expectedDeliveryDate: string | null },
    onSuccess: () => void,
  ): void;
  cancelling: boolean;
  onCancel(): void;
  onOrder(): void;
  onReceive(): void;
  onReturn(): void;
}) {
  const [editing, setEditing] = useState(false);
  const [editingLines, setEditingLines] = useState(false);
  const [reference, setReference] = useState(order.reference ?? '');
  const [expectedDate, setExpectedDate] = useState(order.expectedDeliveryDate ?? '');
  const [confirmCancel, setConfirmCancel] = useState(false);

  useEffect(() => {
    setEditing(false);
    setEditingLines(false);
    setConfirmCancel(false);
    setReference(order.reference ?? '');
    setExpectedDate(order.expectedDeliveryDate ?? '');
  }, [order.id, order.version, order.reference, order.expectedDeliveryDate]);

  const canReturn =
    canReceive &&
    (order.status === 'PARTIALLY_RECEIVED' || order.status === 'RECEIVED') &&
    order.lines.some((line) => line.receivedBaseMicros - line.returnedBaseMicros > 0);

  return (
    <section className="admin-card" aria-label="Purchase order detail">
      <div className="admin-inventory-list__header">
        <span>
          <strong>{order.reference ?? `Purchase order · ${order.supplierName}`}</strong>
          <small>{order.supplierName}</small>
        </span>
        <strong>{statusLabel(order.status)}</strong>
      </div>
      <dl className="admin-definition-grid">
        <div>
          <dt>Expected delivery</dt>
          <dd>{order.expectedDeliveryDate ?? 'Not set'}</dd>
        </div>
      </dl>
      {order.status === 'DRAFT' && canManage ? (
        editing ? (
          <form
            className="admin-form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              onUpdate(
                { reference: reference.trim() || null, expectedDeliveryDate: expectedDate || null },
                () => setEditing(false),
              );
            }}
          >
            <label>
              Reference
              <input
                value={reference}
                maxLength={240}
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
            <div className="admin-inventory-page-actions">
              <button className="admin-primary-button" type="submit" disabled={updating}>
                Save draft
              </button>
              <button
                className="admin-secondary-button"
                type="button"
                disabled={updating}
                onClick={() => setEditing(false)}
              >
                Cancel editing
              </button>
            </div>
          </form>
        ) : (
          <button className="admin-secondary-button" type="button" onClick={() => setEditing(true)}>
            Edit draft
          </button>
        )
      ) : null}
      {canManage && order.status === 'DRAFT' && onReplaceLines ? (
        editingLines ? (
          <DraftPurchaseOrderLinesEditor
            key={order.id + ':' + order.version}
            order={order}
            inventoryItems={inventoryItems}
            pending={replacing}
            onCancel={() => setEditingLines(false)}
            onSave={onReplaceLines}
          />
        ) : (
          <button
            className="admin-secondary-button"
            type="button"
            disabled={replacing}
            onClick={() => setEditingLines(true)}
          >
            Edit draft lines
          </button>
        )
      ) : null}
      <div className="admin-card-grid">
        {order.lines.map((line) => (
          <article className="admin-card" key={line.id}>
            <strong>{line.itemName}</strong>
            <span>{units(line.orderedBaseMicros, line.unitLabel)} ordered</span>
            <span>{units(line.receivedBaseMicros, line.unitLabel)} received</span>
            <span>{units(line.remainingBaseMicros, line.unitLabel)} remaining</span>
            <span>{units(line.returnedBaseMicros, line.unitLabel)} returned</span>
          </article>
        ))}
      </div>
      <div className="admin-inventory-page-actions">
        {(order.status === 'DRAFT' || order.status === 'ORDERED') && canManage ? (
          confirmCancel ? (
            <div className="admin-form-grid">
              <strong>Cancel this purchase order?</strong>
              <span>Cancellation keeps purchase history and cannot be undone.</span>
              <button
                className="admin-secondary-button"
                type="button"
                disabled={cancelling}
                onClick={onCancel}
              >
                Confirm cancel purchase order
              </button>
              <button
                className="admin-secondary-button"
                type="button"
                disabled={cancelling}
                onClick={() => setConfirmCancel(false)}
              >
                Keep purchase order
              </button>
            </div>
          ) : (
            <button
              className="admin-secondary-button"
              type="button"
              disabled={cancelling}
              onClick={() => setConfirmCancel(true)}
            >
              Cancel purchase order
            </button>
          )
        ) : null}
        {order.status === 'DRAFT' && canManage ? (
          <button
            className="admin-primary-button"
            type="button"
            disabled={ordering}
            onClick={onOrder}
          >
            Mark ordered
          </button>
        ) : null}
        {(order.status === 'ORDERED' || order.status === 'PARTIALLY_RECEIVED') && canReceive ? (
          <button className="admin-primary-button" type="button" onClick={onReceive}>
            Receive purchase
          </button>
        ) : null}
        {canReturn ? (
          <button className="admin-secondary-button" type="button" onClick={onReturn}>
            Return purchase
          </button>
        ) : null}
      </div>
    </section>
  );
}
