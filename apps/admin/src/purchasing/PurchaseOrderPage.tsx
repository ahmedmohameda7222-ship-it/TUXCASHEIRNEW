import type { AdminPurchaseOrder } from '@tux/admin-contracts';

function units(value: number, unitLabel: string): string {
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(value / 1_000_000)} ${unitLabel}`;
}

export function PurchaseOrderPage({
  order,
  canManage,
  canReceive,
  ordering,
  onOrder,
  onReceive,
  onReturn,
}: {
  order: AdminPurchaseOrder;
  canManage: boolean;
  canReceive: boolean;
  ordering: boolean;
  onOrder(): void;
  onReceive(): void;
  onReturn(): void;
}) {
  const canReturn =
    canReceive &&
    (order.status === 'PARTIALLY_RECEIVED' || order.status === 'RECEIVED') &&
    order.lines.some((line) => line.receivedBaseMicros - line.returnedBaseMicros > 0);

  return (
    <section className="admin-card" aria-label="Purchase order detail">
      <div className="admin-inventory-list__header">
        <span>
          <strong>{order.reference ?? order.id.slice(0, 8)}</strong>
          <small>{order.supplierName}</small>
        </span>
        <strong>{order.status.replaceAll('_', ' ')}</strong>
      </div>
      <dl className="admin-definition-grid">
        <div>
          <dt>Expected delivery</dt>
          <dd>{order.expectedDeliveryDate ?? 'Not set'}</dd>
        </div>
        <div>
          <dt>Version</dt>
          <dd>{order.version}</dd>
        </div>
      </dl>
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
