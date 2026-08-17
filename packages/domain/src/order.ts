import { DomainInvariantError } from './errors';
import type { OrderSnapshot } from './models';
import { addMoney, assertNonNegativeMoney, subtractMoney } from './money';

export function assertOrderSnapshotIntegrity(order: OrderSnapshot): void {
  if (!Number.isSafeInteger(order.displayOrderNo) || order.displayOrderNo <= 0) {
    throw new DomainInvariantError('Order display number must be a positive safe integer.');
  }
  if (order.idempotencyKey.trim().length === 0) {
    throw new DomainInvariantError('Order idempotency key is required.');
  }
  if (order.items.length === 0) {
    throw new DomainInvariantError('A placed order must contain at least one item.');
  }

  assertNonNegativeMoney(order.itemsSubtotalMinor, 'Items subtotal');
  assertNonNegativeMoney(order.discountMinor, 'Discount');
  assertNonNegativeMoney(order.deliveryFeeMinor, 'Delivery fee');
  assertNonNegativeMoney(order.totalMinor, 'Order total');

  if (order.discountMinor > order.itemsSubtotalMinor) {
    throw new DomainInvariantError('Discount cannot exceed items subtotal.');
  }

  const expectedTotal = addMoney(
    subtractMoney(order.itemsSubtotalMinor, order.discountMinor),
    order.deliveryFeeMinor,
  );
  if (expectedTotal !== order.totalMinor) {
    throw new DomainInvariantError('Order total does not match subtotal, discount, and delivery fee.');
  }

  const allocated = addMoney(...order.payments.map((payment) => payment.allocatedMinor));
  if (allocated !== order.totalMinor) {
    throw new DomainInvariantError('Payment allocation must exactly equal order total.');
  }

  for (const payment of order.payments) {
    assertNonNegativeMoney(payment.allocatedMinor, 'Payment allocation');
    if (payment.method.logicType === 'CASH') {
      if (payment.receivedMinor < payment.allocatedMinor) {
        throw new DomainInvariantError('Cash received cannot be less than its allocated payment amount.');
      }
      if (subtractMoney(payment.receivedMinor, payment.allocatedMinor) !== payment.changeMinor) {
        throw new DomainInvariantError('Cash change does not match received minus allocated amount.');
      }
    }
  }

  const isDelivery = order.fulfillment.behavior === 'DELIVERY';
  if (isDelivery !== (order.fulfillment.delivery !== null)) {
    throw new DomainInvariantError('Delivery snapshot must exist only for Delivery orders.');
  }
}
