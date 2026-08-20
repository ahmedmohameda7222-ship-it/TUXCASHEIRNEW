import { describe, expect, it } from 'vitest';
import {
  cancelActiveOrder,
  canUndoOrderDone,
  markOrderDone,
  orderLifecycle,
  returnFailedDelivery,
  undoOrderDone,
} from './orderLifecycle';
import { instant } from './time';
import { moneyMinor } from './money';
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
import type { OrderSnapshot } from './models';

const id = <T extends EntityId>(value: string) => parseEntityId<T>(value);

function order(behavior: 'TAKE_AWAY' | 'DELIVERY' = 'TAKE_AWAY'): OrderSnapshot {
  const shopId = id<ShopId>('00000000-0000-4000-8000-000000000001');
  const workerId = id<WorkerId>('00000000-0000-4000-8000-000000000002');
  return {
    id: id<OrderId>('00000000-0000-4000-8000-000000000003'),
    shopId,
    businessDayId: id<BusinessDayId>('00000000-0000-4000-8000-000000000004'),
    displayOrderNo: 1,
    idempotencyKey: 'checkout-1',
    status: 'ACTIVE',
    source: 'POS',
    operatorWorkerId: workerId,
    operatorName: 'Ahmed',
    createdAt: instant('2026-08-18T10:00:00.000Z'),
    fulfillment:
      behavior === 'DELIVERY'
        ? {
            behavior: 'DELIVERY',
            orderTypeId: id<OrderTypeId>('00000000-0000-4000-8000-000000000005'),
            orderTypeLabel: 'Delivery',
            delivery: {
              customerContactId: null,
              customerName: 'Mona',
              normalizedPhone: '01000000000',
              address: 'Cairo',
              zoneId: id<DeliveryZoneId>('00000000-0000-4000-8000-000000000006'),
              zoneLabel: 'Nasr City',
              configuredFeeMinor: moneyMinor(2000),
              finalFeeMinor: moneyMinor(2000),
            },
          }
        : {
            behavior: 'TAKE_AWAY',
            orderTypeId: id<OrderTypeId>('00000000-0000-4000-8000-000000000005'),
            orderTypeLabel: 'Take Away',
            delivery: null,
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
    deliveryFeeMinor: behavior === 'DELIVERY' ? moneyMinor(2000) : moneyMinor(0),
    totalMinor: behavior === 'DELIVERY' ? moneyMinor(12000) : moneyMinor(10000),
    payments: [
      {
        id: id<PaymentId>('00000000-0000-4000-8000-000000000009'),
        method: {
          id: id<PaymentMethodId>('00000000-0000-4000-8000-000000000010'),
          label: 'Instapay',
          logicType: 'DIGITAL',
        },
        allocatedMinor: behavior === 'DELIVERY' ? moneyMinor(12000) : moneyMinor(10000),
        receivedMinor: null,
        changeMinor: null,
      },
    ],
  };
}

describe('order lifecycle', () => {
  it('marks done and only permits short-window undo', () => {
    const done = markOrderDone(order(), instant('2026-08-18T10:00:05.000Z'));
    expect(done.status).toBe('DONE');
    expect(orderLifecycle(done).revision).toBe(1);
    expect(canUndoOrderDone(done, instant('2026-08-18T10:00:12.500Z'))).toBe(true);
    expect(canUndoOrderDone(done, instant('2026-08-18T10:00:13.100Z'))).toBe(false);
    const active = undoOrderDone(done);
    expect(active.status).toBe('ACTIVE');
    expect(orderLifecycle(active).revision).toBe(2);
    expect(orderLifecycle(active).doneAt).toBeNull();
  });

  it('captures the cancel prepared/restock decision without touching financial facts', () => {
    const original = order();
    const cancelled = cancelActiveOrder(original, {
      at: instant('2026-08-18T10:01:00.000Z'),
      workerId: original.operatorWorkerId,
      workerName: 'Ahmed',
      foodPrepared: false,
      reason: 'Customer cancelled',
    });
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.totalMinor).toBe(original.totalMinor);
    expect(orderLifecycle(cancelled).cancellation?.stockRestored).toBe(true);
  });

  it('allows Delivery Failed only from a DONE Delivery order', () => {
    const delivery = markOrderDone(order('DELIVERY'), instant('2026-08-18T10:02:00.000Z'));
    const returned = returnFailedDelivery(delivery, {
      at: instant('2026-08-18T10:20:00.000Z'),
      workerId: delivery.operatorWorkerId,
      workerName: 'Ahmed',
      reason: 'Customer unreachable',
    });
    expect(returned.status).toBe('RETURNED');
    expect(orderLifecycle(returned).returned?.reason).toBe('Customer unreachable');
  });
});
