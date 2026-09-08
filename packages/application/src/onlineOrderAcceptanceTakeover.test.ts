import {
  instant,
  moneyMinor,
  parseEntityId,
  type BusinessDayId,
  type MenuCategoryId,
  type OrderTypeId,
  type PaymentMethodId,
  type ProductId,
  type ShopId,
  type WorkerId,
} from '@tux/domain';
import type { CachedOnlineOrderRequest } from '@tux/persistence';
import { describe, expect, it, vi } from 'vitest';
import type { OrdersWorkspace } from './orders';
import { OperationsOnlineOrderAcceptanceService } from './onlineOrderAcceptance';

const SHOP_ID = parseEntityId<ShopId>('a1111111-1111-4111-8111-111111111111');
const DAY_ID = parseEntityId<BusinessDayId>('a2222222-2222-4222-8222-222222222222');
const WORKER_ID = parseEntityId<WorkerId>('a3333333-3333-4333-8333-333333333333');
const CATEGORY_ID = parseEntityId<MenuCategoryId>('a4444444-4444-4444-8444-444444444444');
const PRODUCT_ID = parseEntityId<ProductId>('a5555555-5555-4555-8555-555555555555');
const ORDER_TYPE_ID = parseEntityId<OrderTypeId>('a6666666-6666-4666-8666-666666666666');
const CASH_ID = parseEntityId<PaymentMethodId>('a7777777-7777-4777-8777-777777777777');
const REQUEST_ID = 'a8888888-8888-4888-8888-888888888888';
const RESERVED_ORDER_ID = 'a9999999-9999-4999-8999-999999999999';
const ORIGIN_DEVICE_ID = 'abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TAKEOVER_DEVICE_ID = 'accccccc-cccc-4ccc-8ccc-cccccccccccc';
const NOW = instant('2026-09-08T20:30:00.000Z');

type ClaimedRequestWithReservationAuthority = CachedOnlineOrderRequest & {
  readonly processingDeviceId: string;
  readonly reservationOriginDeviceId: string;
};

function workspace(): OrdersWorkspace {
  return {
    shopId: SHOP_ID,
    businessDayId: DAY_ID,
    configuration: {
      shopId: SHOP_ID,
      version: 1,
      updatedAt: NOW,
      categories: [
        {
          id: CATEGORY_ID,
          shopId: SHOP_ID,
          name: 'Burgers',
          sortOrder: 0,
          active: true,
        },
      ],
      products: [
        {
          id: PRODUCT_ID,
          shopId: SHOP_ID,
          categoryId: CATEGORY_ID,
          name: 'Takeover Burger',
          description: null,
          priceMinor: moneyMinor(10_000),
          imageKey: null,
          active: true,
          soldOut: false,
          isCombo: false,
          sortOrder: 0,
        },
      ],
      modifiers: [],
      productModifierLinks: [],
      comboBeverageOptions: [],
      recipeLines: [],
      orderTypes: [
        {
          id: ORDER_TYPE_ID,
          shopId: SHOP_ID,
          name: 'Take Away',
          behavior: 'TAKE_AWAY',
          active: true,
          sortOrder: 0,
        },
      ],
      paymentMethods: [
        {
          id: CASH_ID,
          shopId: SHOP_ID,
          displayName: 'Cash',
          logicType: 'CASH',
          requiresReconciliation: true,
          active: true,
          sortOrder: 0,
        },
      ],
      deliveryZones: [],
    },
    operator: { id: WORKER_ID, displayName: 'Takeover Worker' },
    draft: {
      shopId: SHOP_ID,
      businessDayId: DAY_ID,
      draftScopeId: 'online-order:takeover-fixture',
      revision: 0,
      updatedAt: NOW,
      checkoutIntentKey: 'takeover-fixture',
      orderTypeId: ORDER_TYPE_ID,
      lines: [],
      orderNote: null,
      discountMinor: moneyMinor(0),
      delivery: {
        displayPhone: '',
        normalizedPhone: '',
        customerName: '',
        address: '',
        zoneId: null,
        zoneLabel: '',
        configuredFeeMinor: moneyMinor(0),
        finalFeeMinor: moneyMinor(0),
      },
      payment: { mode: 'NONE' },
    },
    recoveryState: 'NONE',
    parkedDrafts: [],
  };
}

function takeoverClaim(): ClaimedRequestWithReservationAuthority {
  return {
    requestId: REQUEST_ID,
    shopId: SHOP_ID,
    status: 'PROCESSING',
    catalogRevision: 'a'.repeat(64),
    fulfillmentPreference: 'PICKUP',
    paymentPreference: 'CASH',
    customerName: 'Takeover Customer',
    normalizedPhone: null,
    deliveryAddress: null,
    trustedItems: [
      {
        productId: PRODUCT_ID,
        productName: 'Takeover Burger',
        unitPriceMinor: 10_000,
        quantity: 1,
        modifiers: [],
        comboBeverage: null,
        note: null,
      },
    ],
    itemsSubtotalMinor: 10_000,
    orderNote: null,
    createdAt: instant('2026-09-08T18:00:00.000Z'),
    processingOrderId: RESERVED_ORDER_ID,
    processingStartedAt: instant('2026-09-08T20:00:00.000Z'),
    processingExpiresAt: instant('2026-09-09T08:00:00.000Z'),
    processingDeviceId: TAKEOVER_DEVICE_ID,
    reservationOriginDeviceId: ORIGIN_DEVICE_ID,
  };
}

describe('online-order multi-device acceptance takeover fence', () => {
  it('blocks a later claimant from placing the reserved order owned by another origin device', async () => {
    const placeOrder = vi.fn(async () => {
      throw new Error('PLACEMENT_REACHED');
    });
    const orders = {
      loadWorkspace: vi.fn(async () => ({ ok: true as const, value: workspace() })),
      placeOrder,
    };
    const service = new OperationsOnlineOrderAcceptanceService(orders, {
      now: () => NOW,
      createUuid: () => 'addddddd-dddd-4ddd-8ddd-dddddddddddd',
    });

    await expect(
      service.accept(takeoverClaim(), {
        orderTypeId: ORDER_TYPE_ID,
        deliveryZoneId: null,
        finalDeliveryFeeMinor: null,
        payment: {
          mode: 'SINGLE',
          methodId: CASH_ID,
          cashReceivedMinor: moneyMinor(10_000),
        },
      }),
    ).rejects.toThrow(/origin|reservation|takeover|claimant/i);

    expect(placeOrder).not.toHaveBeenCalled();
  });
});
