import { describe, expect, it } from 'vitest';
import { moneyMinor } from './money';
import { parseEntityId } from './ids';
import { parseOperationsSyncPayloadV1, type OperationsSyncPayloadV1 } from './syncContract';
import { instant } from './time';
import type {
  BusinessDayId,
  DeliveryZoneId,
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

const SHOP_ID = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const DAY_ID = parseEntityId<BusinessDayId>('22222222-2222-4222-8222-222222222222');
const WORKER_ID = parseEntityId<WorkerId>('33333333-3333-4333-8333-333333333333');
const ORDER_ID = parseEntityId<OrderId>('44444444-4444-4444-8444-444444444444');
const ITEM_ID = parseEntityId<OrderItemId>('55555555-5555-4555-8555-555555555555');
const PRODUCT_ID = parseEntityId<ProductId>('66666666-6666-4666-8666-666666666666');
const ORDER_TYPE_ID = parseEntityId<OrderTypeId>('77777777-7777-4777-8777-777777777777');
const PAYMENT_ID = parseEntityId<PaymentId>('88888888-8888-4888-8888-888888888888');
const PAYMENT_METHOD_ID = parseEntityId<PaymentMethodId>(
  '99999999-9999-4999-8999-999999999999',
);
const ZONE_ID = parseEntityId<DeliveryZoneId>('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const AT = instant('2026-09-12T18:00:00.000Z');

function checkoutAwareOrder(): OrderSnapshot {
  return {
    id: ORDER_ID,
    shopId: SHOP_ID,
    businessDayId: DAY_ID,
    displayOrderNo: 42,
    displayOrderLabel: 'TUX-42',
    receiptSnapshot: {
      configurationVersion: 12,
      shopDisplayName: 'TUX',
      address: 'Zahraa El Maadi',
      contactPhone: '01000000000',
      footer: 'Thank you',
      orderNumberPrefix: 'TUX-',
    },
    idempotencyKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    status: 'ACTIVE',
    lifecycle: { revision: 0, doneAt: null, cancellation: null, returned: null },
    source: 'ONLINE',
    operatorWorkerId: WORKER_ID,
    operatorName: 'Worker',
    createdAt: AT,
    fulfillment: {
      orderTypeId: ORDER_TYPE_ID,
      orderTypeLabel: 'Delivery',
      behavior: 'DELIVERY',
      delivery: {
        customerContactId: null,
        customerName: 'Customer',
        normalizedPhone: '01012345678',
        address: 'Nasr City, Cairo',
        zoneId: ZONE_ID,
        zoneLabel: 'Nasr City',
        configuredFeeMinor: moneyMinor(2_500),
        finalFeeMinor: moneyMinor(2_500),
      },
    },
    items: [
      {
        id: ITEM_ID,
        productId: PRODUCT_ID,
        productName: 'Burger',
        unitPriceMinor: moneyMinor(20_000),
        quantity: 1,
        modifiers: [],
        comboBeverages: [],
        itemNote: null,
      },
    ],
    orderNote: null,
    itemsSubtotalMinor: moneyMinor(20_000),
    discountMinor: moneyMinor(0),
    deliveryFeeMinor: moneyMinor(2_500),
    serviceChargeMinor: moneyMinor(2_000),
    taxMinor: moneyMinor(3_430),
    checkoutSnapshot: {
      configurationVersion: 12,
      settingsVersion: 7,
      channel: 'ONLINE',
      minimumOrderMinor: moneyMinor(10_000),
      minimumOrderSatisfied: true,
      serviceChargeBps: 1_000,
      serviceChargeMinor: moneyMinor(2_000),
      taxBps: 1_400,
      taxMinor: moneyMinor(3_430),
      deliveryFeeMinor: moneyMinor(2_500),
      discountMinor: moneyMinor(0),
      paymentRules: [
        {
          paymentMethodId: PAYMENT_METHOD_ID,
          channel: 'ONLINE',
          deliveryZoneId: ZONE_ID,
          zoneAllowed: true,
        },
      ],
    },
    totalMinor: moneyMinor(27_930),
    payments: [
      {
        id: PAYMENT_ID,
        method: {
          id: PAYMENT_METHOD_ID,
          label: 'Cash',
          logicType: 'CASH',
          channel: 'ONLINE',
          requiresReference: false,
          manualConfirmationRequired: true,
          refundAllowed: true,
        },
        allocatedMinor: moneyMinor(27_930),
        receivedMinor: moneyMinor(30_000),
        changeMinor: moneyMinor(2_070),
      },
    ],
  };
}

describe('checkout-aware Operations sync order snapshot', () => {
  it('round-trips immutable checkout, receipt, and payment-rule facts', () => {
    const order = checkoutAwareOrder();
    const payload: OperationsSyncPayloadV1 = {
      eventType: 'ORDER_PLACED',
      version: 1,
      order,
      customerContactUpsert: null,
      inventoryMovements: [],
      configurationVersion: 12,
    };

    const parsed = parseOperationsSyncPayloadV1(JSON.parse(JSON.stringify(payload)) as unknown);

    expect(parsed.eventType).toBe('ORDER_PLACED');
    if (parsed.eventType !== 'ORDER_PLACED') return;
    expect(parsed.order).toEqual(order);
  });
});
