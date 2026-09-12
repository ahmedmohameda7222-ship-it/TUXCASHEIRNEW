import { DomainInvariantError } from './errors';
import type { OrderSnapshot } from './models';
import { addMoney, assertNonNegativeMoney, subtractMoney, ZERO_MONEY } from './money';

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

  const serviceChargeMinor = order.serviceChargeMinor ?? ZERO_MONEY;
  const taxMinor = order.taxMinor ?? ZERO_MONEY;

  assertNonNegativeMoney(order.itemsSubtotalMinor, 'Items subtotal');
  assertNonNegativeMoney(order.discountMinor, 'Discount');
  assertNonNegativeMoney(order.deliveryFeeMinor, 'Delivery fee');
  assertNonNegativeMoney(serviceChargeMinor, 'Service charge');
  assertNonNegativeMoney(taxMinor, 'Tax');
  assertNonNegativeMoney(order.totalMinor, 'Order total');

  if (order.discountMinor > order.itemsSubtotalMinor) {
    throw new DomainInvariantError('Discount cannot exceed items subtotal.');
  }

  const expectedTotal = addMoney(
    subtractMoney(order.itemsSubtotalMinor, order.discountMinor),
    serviceChargeMinor,
    order.deliveryFeeMinor,
    taxMinor,
  );
  if (expectedTotal !== order.totalMinor) {
    throw new DomainInvariantError(
      'Order total does not match subtotal, discount, service charge, delivery fee, and tax.',
    );
  }

  if (order.checkoutSnapshot !== undefined) {
    const snapshot = order.checkoutSnapshot;
    if (
      !Number.isSafeInteger(snapshot.configurationVersion) ||
      snapshot.configurationVersion <= 0
    ) {
      throw new DomainInvariantError('Checkout configuration version must be positive.');
    }
    if (
      snapshot.settingsVersion !== null &&
      (!Number.isSafeInteger(snapshot.settingsVersion) || snapshot.settingsVersion <= 0)
    ) {
      throw new DomainInvariantError('Checkout settings version must be positive when present.');
    }
    if (snapshot.channel !== order.source) {
      throw new DomainInvariantError('Checkout channel snapshot must match the order source.');
    }
    if (snapshot.serviceChargeMinor !== serviceChargeMinor || snapshot.taxMinor !== taxMinor) {
      throw new DomainInvariantError('Checkout charge snapshot must match the order totals.');
    }
    if (
      snapshot.deliveryFeeMinor !== order.deliveryFeeMinor ||
      snapshot.discountMinor !== order.discountMinor
    ) {
      throw new DomainInvariantError('Checkout fee and discount snapshot must match the order.');
    }
    if (snapshot.minimumOrderSatisfied !== order.itemsSubtotalMinor >= snapshot.minimumOrderMinor) {
      throw new DomainInvariantError('Checkout minimum-order snapshot is inconsistent.');
    }
  }

  const allocated = addMoney(...order.payments.map((payment) => payment.allocatedMinor));
  if (allocated !== order.totalMinor) {
    throw new DomainInvariantError('Payment allocation must exactly equal order total.');
  }

  for (const payment of order.payments) {
    assertNonNegativeMoney(payment.allocatedMinor, 'Payment allocation');

    if (payment.method.logicType === 'CASH') {
      const receivedMinor = payment.receivedMinor;
      const changeMinor = payment.changeMinor;

      if (receivedMinor === null || changeMinor === null) {
        throw new DomainInvariantError('Cash payment requires received and change amounts.');
      }
      if (receivedMinor < payment.allocatedMinor) {
        throw new DomainInvariantError(
          'Cash received cannot be less than its allocated payment amount.',
        );
      }
      if (subtractMoney(receivedMinor, payment.allocatedMinor) !== changeMinor) {
        throw new DomainInvariantError(
          'Cash change does not match received minus allocated amount.',
        );
      }
    }
  }

  const isDelivery = order.fulfillment.behavior === 'DELIVERY';
  if (isDelivery !== (order.fulfillment.delivery !== null)) {
    throw new DomainInvariantError('Delivery snapshot must exist only for Delivery orders.');
  }
}
