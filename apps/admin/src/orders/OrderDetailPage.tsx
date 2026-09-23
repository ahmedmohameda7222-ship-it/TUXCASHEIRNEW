import type { AdminOrderDetail } from '@tux/admin-contracts';

function money(minor: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'EGP',
    minimumFractionDigits: 2,
  }).format(minor / 100);
}

function label(value: string): string {
  return value.replaceAll('_', ' ');
}

export function OrderDetailPage({
  order,
  canCancel,
  canRefund,
  cancelling,
  refunding,
  returning,
  onCancel,
  onRefund,
  onReturn,
}: {
  order: AdminOrderDetail;
  canCancel: boolean;
  canRefund: boolean;
  cancelling: boolean;
  refunding: boolean;
  returning: boolean;
  onCancel(): void;
  onRefund(): void;
  onReturn(): void;
}) {
  const canCancelActive = order.status === 'ACTIVE' && canCancel;
  const canRefundOrReturn = order.status !== 'ACTIVE' && canRefund;

  return (
    <article aria-labelledby="admin-order-detail-title">
      <header>
        <p>{order.displayOrderLabel ?? `#${order.displayOrderNo}`}</p>
        <h1 id="admin-order-detail-title">Order detail</h1>
        <p>
          {order.status} · {order.source} · revision {order.operationalRevision}
        </p>
        <p>{money(order.totalMinor)}</p>
      </header>

      <section aria-labelledby="admin-order-items-title">
        <h2 id="admin-order-items-title">Items</h2>
        {order.items.map((item) => (
          <article key={item.id}>
            <h3>
              {item.quantity} × {item.productName}
            </h3>
            <p>{money(item.unitPriceMinor)}</p>
            {item.itemNote ? <p>{item.itemNote}</p> : null}
            {item.modifiers.length > 0 ? (
              <ul aria-label="Modifiers">
                {item.modifiers.map((modifier, index) => (
                  <li key={modifier.id ?? `${item.id}:modifier:${index}`}>
                    {modifier.quantity} × {modifier.label} · {money(modifier.unitPriceMinor)}
                  </li>
                ))}
              </ul>
            ) : null}
            {item.comboBeverages.length > 0 ? (
              <ul aria-label="Combo beverages">
                {item.comboBeverages.map((beverage, index) => (
                  <li key={`${item.id}:beverage:${beverage.productId}:${index}`}>
                    {beverage.label}
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
        ))}
      </section>

      <section aria-labelledby="admin-order-customer-title">
        <h2 id="admin-order-customer-title">Customer</h2>
        {order.customer ? (
          <>
            <p>{order.customer.name ?? 'Unnamed customer'}</p>
            {order.customer.normalizedPhone ? <p>{order.customer.normalizedPhone}</p> : null}
          </>
        ) : (
          <p>No customer attached</p>
        )}
      </section>

      <section aria-labelledby="admin-order-fulfillment-title">
        <h2 id="admin-order-fulfillment-title">Fulfillment</h2>
        {order.fulfillment ? (
          <>
            <p>
              {order.fulfillment.orderTypeLabel} · {order.fulfillment.behavior}
            </p>
            {order.fulfillment.address ? <p>{order.fulfillment.address}</p> : null}
            {order.fulfillment.deliveryZoneLabel ? (
              <p>{order.fulfillment.deliveryZoneLabel}</p>
            ) : null}
            <p>Delivery fee {money(order.fulfillment.finalDeliveryFeeMinor)}</p>
          </>
        ) : (
          <p>No fulfillment snapshot</p>
        )}
      </section>

      <section aria-labelledby="admin-order-payments-title">
        <h2 id="admin-order-payments-title">Payments</h2>
        {order.payments.length === 0 ? (
          <p>No payment records</p>
        ) : (
          <ul>
            {order.payments.map((payment) => (
              <li key={payment.id}>
                {payment.methodLabel} · {payment.logicType} · {money(payment.allocatedMinor)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="admin-order-financial-title">
        <h2 id="admin-order-financial-title">Financial corrections</h2>
        {order.financialEvents.length === 0 ? (
          <p>No refund or return events</p>
        ) : (
          <ol>
            {order.financialEvents.map((event) => (
              <li key={event.id}>
                <strong>{event.kind}</strong> · {label(event.state)} · {money(event.amountMinor)} ·{' '}
                {event.reason.label} · reason v{event.reason.configurationVersion}
                {event.note ? <> · {event.note}</> : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="admin-order-inventory-title">
        <h2 id="admin-order-inventory-title">Inventory effect</h2>
        {order.inventoryMovements.length === 0 ? (
          <p>No inventory movements</p>
        ) : (
          <ul>
            {order.inventoryMovements.map((movement) => (
              <li key={movement.id}>
                {label(movement.movementType)} · quantity {movement.quantityDeltaMicros} · reserved{' '}
                {movement.reservedDeltaMicros}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="admin-order-status-history-title">
        <h2 id="admin-order-status-history-title">Status history</h2>
        {order.statusHistory.length === 0 ? (
          <p>No status history</p>
        ) : (
          <ol>
            {order.statusHistory.map((event) => (
              <li key={event.id}>
                <strong>{label(event.eventType)}</strong>
                {event.workerName ? <> · {event.workerName}</> : null}
                {event.reason ? <> · {event.reason.label}</> : null}
                {event.note ? <> · {event.note}</> : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="admin-order-audit-title">
        <h2 id="admin-order-audit-title">Audit</h2>
        {order.auditEvents.length === 0 ? (
          <p>No audit events</p>
        ) : (
          <ul>
            {order.auditEvents.map((event) => (
              <li key={event.id}>{label(event.actionType)}</li>
            ))}
          </ul>
        )}
      </section>

      {(canCancelActive || canRefundOrReturn) && (
        <section aria-labelledby="admin-order-actions-title">
          <h2 id="admin-order-actions-title">Sensitive actions</h2>
          {canCancelActive ? (
            <button type="button" disabled={cancelling} onClick={onCancel}>
              {cancelling ? 'Cancelling…' : 'Cancel order'}
            </button>
          ) : null}
          {canRefundOrReturn ? (
            <>
              <button type="button" disabled={refunding || returning} onClick={onRefund}>
                {refunding ? 'Refunding…' : 'Refund / return'}
              </button>
              <button type="button" disabled={refunding || returning} onClick={onReturn}>
                {returning ? 'Returning…' : 'Return items'}
              </button>
            </>
          ) : null}
        </section>
      )}
    </article>
  );
}
