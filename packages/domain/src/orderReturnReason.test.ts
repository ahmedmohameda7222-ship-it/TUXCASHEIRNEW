import { describe, expect, it } from 'vitest';
import { parseEntityId } from './ids';
import type {
  BusinessDayId,
  DeliveryZoneId,
  EntityId,
  OrderId,
  OrderItemId,
  OrderTypeId,
  PaymentId,
  PaymentMethodId,
  ProductId,
  ShopId,
  WorkerId,
} from './ids';
import { moneyMinor } from './money';
import type { OrderReasonCodeSnapshot, OrderSnapshot } from './models';
import { markOrderDone, orderLifecycle, returnFailedDelivery } from './orderLifecycle';
import { instant } from './time';

const id = <T extends EntityId>(value: string) => parseEntityId<T>(value);

function doneDelivery(): OrderSnapshot {
  const workerId = id<WorkerId>('00000000-0000-4000-8000-000000000002');
  const original: OrderSnapshot = {
    id: id<OrderId>('00000000-0000-4000-8000-000000000003'),
    shopId: id<ShopId>('00000000-0000-4000-8000-000000000001'),
    businessDayId: id<BusinessDayId>('00000000-0000-4000-8000-000000000004'),
    displayOrderNo: 1,
    idempotencyKey: 'return-reason-1',
    status: 'ACTIVE',
    source: 'POS',
    operatorWorkerId: workerId,
    operatorName: 'Ahmed',
    createdAt: instant('2026-09-14T03:00:00.000Z'),
    fulfillment: {
      behavior: 'DELIVERY',
      orderTypeId: id<OrderTypeId>('00000000-0000-4000-8000-000000000005'),
      orderTypeLabel: 'Delivery',
      delivery: {
        customerContactId: null,
        customerName: 'Mona',
        normalizedPhone: '01000000000',
        address: 'Cairo',
        zoneId: id<DeliveryZoneId>('00000000-0000-4000-8000-000000000006'),
        zoneLabel: 'Maadi',
        configuredFeeMinor: moneyMinor(2000),
        finalFeeMinor: moneyMinor(2000),
      },
    },
    items: [
      {
        id: id<OrderItemId>('00000000-0000-4000-8000-000000000007'),
        productId: id<ProductId>('00000000-0000-4000-8000-000000000008'),
        productName: 'Burger',
        unitPriceMinor: moneyMinor(10000),
        quantity: 1,
        modifiers: [],
        comboBeverages: [],
        itemNote: null,
      },
    ],
    orderNote: null,
    itemsSubtotalMinor: moneyMinor(10000),
    discountMinor: moneyMinor(0),
    deliveryFeeMinor: moneyMinor(2000),
    totalMinor: moneyMinor(12000),
    payments: [
      {
        id: id<PaymentId>('00000000-0000-4000-8000-000000000009'),
        method: {
          id: id<PaymentMethodId>('00000000-0000-4000-8000-000000000010'),
          label: 'Instapay',
          logicType: 'DIGITAL',
        },
        allocatedMinor: moneyMinor(12000),
        receivedMinor: null,
        changeMinor: null,
      },
    ],
  };
  return markOrderDone(original, instant('2026-09-14T03:05:00.000Z'));
}

const returnReason: OrderReasonCodeSnapshot = {
  id: '50000000-0000-4000-8000-000000000011',
  key: 'CUSTOMER_UNREACHABLE',
  family: 'REFUND_RETURN',
  label: 'Customer unreachable',
  version: 3,
  scope: 'SHOP',
};

describe('delivery return reason authority', () => {
  it('uses the published REFUND_RETURN identity as the canonical immutable reason', () => {
    const order = doneDelivery();
    const returned = returnFailedDelivery(order, {
      at: instant('2026-09-14T03:20:00.000Z'),
      workerId: order.operatorWorkerId,
      workerName: 'Ahmed',
      reason: 'arbitrary free text',
      reasonCode: returnReason,
      note: 'Driver called twice',
    } as never);

    expect(orderLifecycle(returned).returned).toMatchObject({
      reason: returnReason.label,
      note: 'Driver called twice',
      reasonCode: returnReason,
    });
  });

  it('rejects a configured reason from the wrong family', () => {
    const order = doneDelivery();
    expect(() =>
      returnFailedDelivery(order, {
        at: instant('2026-09-14T03:20:00.000Z'),
        workerId: order.operatorWorkerId,
        workerName: 'Ahmed',
        reason: 'wrong family',
        reasonCode: { ...returnReason, family: 'CANCELLATION' },
      } as never),
    ).toThrow(/REFUND_RETURN/i);
  });
});
