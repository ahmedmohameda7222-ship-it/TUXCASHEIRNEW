import type { AdminOrderDetail } from '@tux/admin-contracts';

function money(minor: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'EGP',
    minimumFractionDigits: 2,
  }).format(minor / 100);
}

function friendly(value: string): string {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function quantity(micros: number, unitLabel = 'units'): string {
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(
    micros / 1_000_000,
  )} ${unitLabel}`;
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
  const canRefundOrReturn = ['DONE', 'RETURNED'].includes(order.status) && canRefund;

  return (
    <article className="admin-order-detail" aria-labelledby="admin-order-detail-title">
      <header className="admin-order-detail__summary">
        <div>
          <p className="admin-page__eyebrow">
            {order.displayOrderLabel ?? `#${order.displayOrderNo}`}
          </p>
          <h2 id="admin-order-detail-title">Order detail</h2>
          <p>
            {friendly(order.status)} · {order.source === 'POS' ? 'In-store' : 'Online'}
          </p>
        </div>
        <strong className="admin-order-detail__total">{money(order.totalMinor)}</strong>
      </header>

      <section className="admin-order-detail__card" aria-labelledby="admin-order-items-title">
        <h3 id="admin-order-items-title">Items</h3>
        <div className="admin-order-detail__list">
          {order.items.map((item) => (
            <article className="admin-order-detail__row" key={item.id}>
              <div>
                <strong>
                  {item.quantity} × {item.productName}
                </strong>
                {item.itemNote ? <small>{item.itemNote}</small> : null}
                {item.modifiers.map((modifier, index) => (
                  <small key={modifier.id ?? `${item.id}:modifier:${index}`}>
                    {modifier.quantity} × {modifier.label} · {money(modifier.unitPriceMinor)}
                  </small>
                ))}
                {item.comboBeverages.map((beverage, index) => (
                  <small key={`${item.id}:beverage:${beverage.productId}:${index}`}>
                    {beverage.label}
                  </small>
                ))}
              </div>
              <strong>{money(item.unitPriceMinor * item.quantity)}</strong>
            </article>
          ))}
        </div>
      </section>

      <div className="admin-order-detail__grid">
        <section className="admin-order-detail__card" aria-labelledby="admin-order-customer-title">
          <h3 id="admin-order-customer-title">Customer</h3>
          {order.customer ? (
            <>
              <strong>{order.customer.name ?? 'Unnamed customer'}</strong>
              {order.customer.normalizedPhone ? <p>{order.customer.normalizedPhone}</p> : null}
            </>
          ) : (
            <p>Walk-in customer</p>
          )}
        </section>

        <section
          className="admin-order-detail__card"
          aria-labelledby="admin-order-fulfillment-title"
        >
          <h3 id="admin-order-fulfillment-title">Fulfillment</h3>
          {order.fulfillment ? (
            <>
              <strong>{order.fulfillment.orderTypeLabel}</strong>
              {order.fulfillment.address ? <p>{order.fulfillment.address}</p> : null}
              {order.fulfillment.deliveryZoneLabel ? (
                <p>{order.fulfillment.deliveryZoneLabel}</p>
              ) : null}
              <p>Delivery fee {money(order.fulfillment.finalDeliveryFeeMinor)}</p>
            </>
          ) : (
            <p>No fulfillment details</p>
          )}
        </section>
      </div>

      <section className="admin-order-detail__card" aria-labelledby="admin-order-payments-title">
        <h3 id="admin-order-payments-title">Payments</h3>
        {order.payments.length === 0 ? (
          <p>No payment records</p>
        ) : (
          <ul className="admin-order-detail__list">
            {order.payments.map((payment) => (
              <li className="admin-order-detail__row" key={payment.id}>
                <span>{payment.methodLabel}</span>
                <strong>{money(payment.allocatedMinor)}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="admin-order-detail__card" aria-labelledby="admin-order-financial-title">
        <h3 id="admin-order-financial-title">Financial corrections</h3>
        {order.financialEvents.length === 0 ? (
          <p>No refunds or returns</p>
        ) : (
          <ol className="admin-order-detail__list">
            {order.financialEvents.map((event) => (
              <li className="admin-order-detail__row" key={event.id}>
                <span>
                  <strong>{event.kind === 'REFUND' ? 'Refund' : 'Return'}</strong>
                  <small>
                    {friendly(event.state)} · {event.reason.label}
                  </small>
                  {event.note ? <small>{event.note}</small> : null}
                </span>
                <strong>{money(event.amountMinor)}</strong>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="admin-order-detail__card" aria-labelledby="admin-order-inventory-title">
        <h3 id="admin-order-inventory-title">Inventory effect</h3>
        {order.inventoryMovements.length === 0 ? (
          <p>No inventory movements</p>
        ) : (
          <ul className="admin-order-detail__list">
            {order.inventoryMovements.map((movement) => (
              <li className="admin-order-detail__row" key={movement.id}>
                <span>
                  <strong>{movement.inventoryItemName ?? 'Inventory item'}</strong>
                  <small>{friendly(movement.movementType)}</small>
                </span>
                <span>
                  {quantity(movement.quantityDeltaMicros, movement.unitLabel)} quantity ·{' '}
                  {quantity(movement.reservedDeltaMicros, movement.unitLabel)} reserved
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="admin-order-detail__card" aria-labelledby="admin-order-history-title">
        <h3 id="admin-order-history-title">Timeline and history</h3>
        {order.statusHistory.length === 0 ? (
          <p>No status history</p>
        ) : (
          <ol className="admin-order-detail__list">
            {order.statusHistory.map((event) => (
              <li className="admin-order-detail__row" key={event.id}>
                <span>
                  <strong>{friendly(event.eventType)}</strong>
                  {event.workerName ? <small>{event.workerName}</small> : null}
                  {event.reason ? <small>{event.reason.label}</small> : null}
                  {event.note ? <small>{event.note}</small> : null}
                </span>
              </li>
            ))}
          </ol>
        )}
        {order.auditEvents.length > 0 ? (
          <details>
            <summary>Administrative history</summary>
            <ul>
              {order.auditEvents.map((event) => (
                <li key={event.id}>{friendly(event.actionType)}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      {canCancelActive || canRefundOrReturn ? (
        <section
          className="admin-order-detail__card admin-order-detail__actions"
          aria-labelledby="admin-order-actions-title"
        >
          <h3 id="admin-order-actions-title">Sensitive actions</h3>
          {canCancelActive ? (
            <button
              className="admin-destructive-button"
              type="button"
              disabled={cancelling}
              onClick={onCancel}
            >
              {cancelling ? 'Cancelling…' : 'Cancel order'}
            </button>
          ) : null}
          {canRefundOrReturn ? (
            <>
              <button
                className="admin-secondary-button"
                type="button"
                disabled={refunding || returning}
                onClick={onRefund}
              >
                {refunding ? 'Refunding…' : 'Refund payment'}
              </button>
              <button
                className="admin-destructive-button"
                type="button"
                disabled={refunding || returning}
                onClick={onReturn}
              >
                {returning ? 'Returning…' : 'Return items'}
              </button>
            </>
          ) : null}
        </section>
      ) : null}
    </article>
  );
}
