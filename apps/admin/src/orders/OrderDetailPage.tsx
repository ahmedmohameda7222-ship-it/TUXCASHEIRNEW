import type { AdminOrderDetail } from '@tux/admin-contracts';
import { Link } from 'wouter';

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
  canReviewApprovals,
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
  canReviewApprovals: boolean;
  cancelling: boolean;
  refunding: boolean;
  returning: boolean;
  onCancel(): void;
  onRefund(): void;
  onReturn(): void;
}) {
  const recordedPaymentMinor = order.payments.reduce(
    (sum, payment) => sum + payment.allocatedMinor,
    0,
  );
  const hasRecordedPayment = recordedPaymentMinor > 0;
  const postedRefundMinor = order.financialEvents
    .filter((event) => event.kind === 'REFUND' && event.state === 'POSTED')
    .reduce((sum, event) => sum + event.amountMinor, 0);
  const pendingRefundMinor = order.financialEvents
    .filter(
      (event) =>
        event.kind === 'REFUND' &&
        ['PENDING_APPROVAL', 'APPROVED', 'EXECUTING'].includes(event.state),
    )
    .reduce((sum, event) => sum + event.amountMinor, 0);
  const postedReturnValuationMinor = order.financialEvents
    .filter((event) => event.kind === 'RETURN' && event.state === 'POSTED')
    .reduce((sum, event) => sum + event.amountMinor, 0);
  const netAfterPostedRefundsMinor = order.totalMinor - postedRefundMinor;
  const outstandingSettlementMinor = order.totalMinor - recordedPaymentMinor;
  const canCancelActive = order.status === 'ACTIVE' && canCancel && !hasRecordedPayment;
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

      <section className="admin-order-detail__card" aria-label="Order identity">
        <h3>Order identity</h3>
        <p>Business day: {order.businessDayId ?? 'Not available'}</p>
        <p>
          Unique order reference: <code>{order.id}</code>
        </p>
        {order.operatorName ? <p>Operator: {order.operatorName}</p> : null}
        <p>
          Created:{' '}
          <time dateTime={order.createdAt}>
            {new Intl.DateTimeFormat('en-EG', {
              dateStyle: 'medium',
              timeStyle: 'short',
              timeZone: 'Africa/Cairo',
            }).format(new Date(order.createdAt))}{' '}
            (Cairo)
          </time>
        </p>
      </section>

      <section className="admin-order-detail__card" aria-labelledby="admin-order-items-title">
        <h3 id="admin-order-items-title">Items</h3>
        <div className="admin-order-detail__list">
          {order.items.map((item) => {
            const modifierUnitMinor = item.modifiers.reduce(
              (total, modifier) => total + modifier.quantity * modifier.unitPriceMinor,
              0,
            );
            const effectiveUnitMinor = item.unitPriceMinor + modifierUnitMinor;
            return (
              <article className="admin-order-detail__row" key={item.id}>
                <div>
                  <strong>
                    {item.quantity} × {item.productName}
                  </strong>
                  <small>Base unit · {money(item.unitPriceMinor)}</small>
                  {item.itemNote ? <small>{item.itemNote}</small> : null}
                  {item.modifiers.map((modifier, index) => (
                    <small key={modifier.id ?? `${item.id}:modifier:${index}`}>
                      {modifier.quantity} × {modifier.label} · {money(modifier.unitPriceMinor)} each
                    </small>
                  ))}
                  {item.comboBeverages.map((beverage, index) => (
                    <small key={`${item.id}:beverage:${beverage.productId}:${index}`}>
                      {beverage.label} · included in combo snapshot
                    </small>
                  ))}
                  <small>Modifier extras per unit · {money(modifierUnitMinor)}</small>
                  <small>Effective unit · {money(effectiveUnitMinor)}</small>
                  <small>Quantity · {item.quantity}</small>
                </div>
                <span>
                  <strong>{money(effectiveUnitMinor * item.quantity)}</strong>
                  <small>Line total before discounts</small>
                </span>
              </article>
            );
          })}
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

      <section className="admin-order-detail__card" aria-label="Order financial breakdown">
        <h3>Order financial breakdown</h3>
        <dl>
          <dt>Items subtotal</dt>
          <dd>
            {order.itemsSubtotalMinor === undefined
              ? 'Not available'
              : money(order.itemsSubtotalMinor)}
          </dd>
          <dt>Discount</dt>
          <dd>
            {order.discountMinor === undefined ? 'Not available' : money(order.discountMinor)}
          </dd>
          <dt>Delivery fee</dt>
          <dd>{money(order.fulfillment?.finalDeliveryFeeMinor ?? 0)}</dd>
          <dt>Service charge</dt>
          <dd>
            {order.serviceChargeMinor === undefined
              ? 'Not available'
              : money(order.serviceChargeMinor)}
          </dd>
          <dt>Tax</dt>
          <dd>{order.taxMinor === undefined ? 'Not available' : money(order.taxMinor)}</dd>
          <dt>Grand total</dt>
          <dd>
            <strong>{money(order.totalMinor)}</strong>
          </dd>
          <dt>Allocated payments</dt>
          <dd>{money(recordedPaymentMinor)}</dd>
          <dt>Posted refunds</dt>
          <dd>{money(postedRefundMinor)}</dd>
          <dt>Pending refunds (not posted)</dt>
          <dd>{money(pendingRefundMinor)}</dd>
          <dt>Posted return valuation (not a refund)</dt>
          <dd>{money(postedReturnValuationMinor)}</dd>
          <dt>Net after posted refunds</dt>
          <dd>{money(netAfterPostedRefundsMinor)}</dd>
          <dt>Outstanding settlement</dt>
          <dd>{money(outstandingSettlementMinor)}</dd>
        </dl>
        <small>
          Figures are calculated from recorded order snapshots and financial adjustments. Payment
          allocation does not prove external collection, and a posted accounting refund does not
          prove a completed external payout. Return valuation is not a refund.
        </small>
      </section>

      <section className="admin-order-detail__card" aria-labelledby="admin-order-payments-title">
        <h3 id="admin-order-payments-title">Payments</h3>
        {order.payments.length === 0 ? (
          <p>No payment records</p>
        ) : (
          <ul className="admin-order-detail__list">
            {order.payments.map((payment) => (
              <li className="admin-order-detail__row" key={payment.id}>
                <span>
                  {payment.methodLabel}
                  {payment.receivedMinor !== null ? (
                    <small>
                      Cash received {money(payment.receivedMinor)} · change{' '}
                      {money(payment.changeMinor ?? 0)}
                    </small>
                  ) : null}
                  {payment.refundAllowedSnapshot === false ? (
                    <small>Nonrefundable method</small>
                  ) : null}
                </span>
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
                  {event.kind === 'RETURN' && event.returnItems?.length ? (
                    <ul>
                      {event.returnItems.map((line) => (
                        <li key={line.orderItemId}>
                          <small>Returned {line.quantity} × {line.productName}</small>
                          <small>Return valuation: {money(line.valuationMinor)}</small>
                          <small>Order-item reference: {line.orderItemId}</small>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <small>
                    Requested:{' '}
                    {new Intl.DateTimeFormat('en-EG', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                      timeZone: 'Africa/Cairo',
                    }).format(new Date(event.createdAt))}
                  </small>
                  {event.requestedByEmployeeId ? (
                    <small>Requester: {event.requestedByEmployeeId}</small>
                  ) : null}
                  {event.approvedByEmployeeId ? (
                    <small>Approver: {event.approvedByEmployeeId}</small>
                  ) : null}
                  {event.decidedAt ? (
                    <small>
                      Decision:{' '}
                      {new Intl.DateTimeFormat('en-EG', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                        timeZone: 'Africa/Cairo',
                      }).format(new Date(event.decidedAt))}
                    </small>
                  ) : null}
                  {event.executedAt ? (
                    <small>
                      Execution:{' '}
                      {new Intl.DateTimeFormat('en-EG', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                        timeZone: 'Africa/Cairo',
                      }).format(new Date(event.executedAt))}
                    </small>
                  ) : null}
                  {event.decisionReason ? (
                    <small>Decision reason: {event.decisionReason}</small>
                  ) : null}
                  {event.approvalRequestId ? (
                    <>
                      <small>Approval reference: {event.approvalRequestId}</small>
                      {canReviewApprovals ? (
                        <Link href={`/approvals/${event.approvalRequestId}`}>
                          Review approval
                        </Link>
                      ) : null}
                    </>
                  ) : null}
                  <small>
                    {event.kind === 'RETURN'
                      ? 'Return valuation; no payment refund implied'
                      : 'Refund record; external payout not confirmed'}
                  </small>
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
                  <small>
                    {event.fromStatus ? friendly(event.fromStatus) : 'New'} →{' '}
                    {friendly(event.toStatus)}
                  </small>
                  <small>
                    {new Intl.DateTimeFormat('en-EG', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                      timeZone: 'Africa/Cairo',
                    }).format(new Date(event.createdAt))} (Cairo)
                  </small>
                  <small>Revision {event.operationalRevision}</small>
                  {event.workerName ? <small>Worker: {event.workerName}</small> : null}
                  {event.adminEmployeeId ? (
                    <small>Admin actor: {event.adminEmployeeId}</small>
                  ) : null}
                  {!event.workerName && !event.adminEmployeeId ? (
                    <small>Actor not recorded</small>
                  ) : null}
                  {event.reason ? <small>Reason: {event.reason.label}</small> : null}
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
                <li key={event.id}>
                  <strong>{friendly(event.actionType)}</strong>
                  <small>
                    {' '}Audit timestamp:{' '}
                    {new Intl.DateTimeFormat('en-EG', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                      timeZone: 'Africa/Cairo',
                    }).format(new Date(event.createdAt))} (Cairo)
                  </small>
                  {event.actorEmployeeId ? (
                    <small> · Admin actor: {event.actorEmployeeId}</small>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      {order.status === 'ACTIVE' && hasRecordedPayment ? (
        <section
          className="admin-order-detail__card"
          role="status"
          aria-label="Paid active order cancellation restriction"
        >
          <h3>Paid active order</h3>
          <p>
            Recorded payments: {money(recordedPaymentMinor)}. Admin cancellation is blocked until an
            authorized financial settlement policy is available.
          </p>
          <p>
            Keep the order active or complete the existing Operations lifecycle and use the
            authorized refund workflow when eligible. Nonrefundable payment methods require an
            explicit finance resolution. A ledger adjustment does not confirm an external refund.
          </p>
        </section>
      ) : null}

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
