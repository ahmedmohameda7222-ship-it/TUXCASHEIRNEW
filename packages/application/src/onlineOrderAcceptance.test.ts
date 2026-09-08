import {
  instant,
  moneyMinor,
  parseEntityId,
  type BusinessDayId,
  type DeliveryZoneId,
  type MenuCategoryId,
  type OperationsConfigurationSnapshot,
  type OrderTypeId,
  type PaymentMethodId,
  type ProductId,
  type ShopId,
  type WorkerId,
} from '@tux/domain';
import type { CachedOnlineOrderRequest } from '@tux/persistence';
import { describe, expect, it, vi } from 'vitest';
import type { OrdersWorkspace } from './orders';
import {
  OperationsOnlineOrderAcceptanceService,
  prepareOnlineOrderAcceptanceDraft,
} from './onlineOrderAcceptance';

const SHOP_ID = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const DAY_ID = parseEntityId<BusinessDayId>('22222222-2222-4222-8222-222222222222');
const WORKER_ID = parseEntityId<WorkerId>('33333333-3333-4333-8333-333333333333');
const CATEGORY_ID = parseEntityId<MenuCategoryId>('44444444-4444-4444-8444-444444444444');
const PRODUCT_ID = parseEntityId<ProductId>('55555555-5555-4555-8555-555555555555');
const TAKE_AWAY_ID = parseEntityId<OrderTypeId>('66666666-6666-4666-8666-666666666666');
const DELIVERY_ID = parseEntityId<OrderTypeId>('77777777-7777-4777-8777-777777777777');
const ZONE_ID = parseEntityId<DeliveryZoneId>('88888888-8888-4888-8888-888888888888');
const CASH_ID = parseEntityId<PaymentMethodId>('99999999-9999-4999-8999-999999999999');
const REQUEST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROCESSING_ORDER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const AT = instant('2026-09-08T16:00:00.000Z');

const CONFIGURATION: OperationsConfigurationSnapshot = {
  shopId: SHOP_ID,
  version: 12,
  updatedAt: AT,
  categories: [
    { id: CATEGORY_ID, shopId: SHOP_ID, name: 'Burgers', sortOrder: 0, active: true },
  ],
  products: [
    {
      id: PRODUCT_ID,
      shopId: SHOP_ID,
      categoryId: CATEGORY_ID,
      name: 'Online Burger',
      description: null,
      priceMinor: moneyMinor(19_000),
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
      id: TAKE_AWAY_ID,
      shopId: SHOP_ID,
      name: 'Take Away',
      behavior: 'TAKE_AWAY',
      active: true,
      sortOrder: 0,
    },
    {
      id: DELIVERY_ID,
      shopId: SHOP_ID,
      name: 'Delivery',
      behavior: 'DELIVERY',
      active: true,
      sortOrder: 1,
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
  deliveryZones: [
    {
      id: ZONE_ID,
      shopId: SHOP_ID,
      name: 'Nasr City',
      feeMinor: moneyMinor(3_000),
      active: true,
      sortOrder: 0,
    },
  ],
};

function request(overrides: Partial<CachedOnlineOrderRequest> = {}): CachedOnlineOrderRequest {
  return {
    requestId: REQUEST_ID,
    shopId: SHOP_ID,
    status: 'PROCESSING',
    catalogRevision: 'a'.repeat(64),
    fulfillmentPreference: 'DELIVERY',
    paymentPreference: 'CASH',
    customerName: 'Online Customer',
    normalizedPhone: '01012345678',
    deliveryAddress: 'Nasr City, Cairo',
    trustedItems: [
      {
        productId: PRODUCT_ID,
        productName: 'Online Burger',
        unitPriceMinor: 19_000,
        quantity: 1,
        modifiers: [],
        comboBeverage: null,
        note: 'No onions',
      },
    ],
    itemsSubtotalMinor: 19_000,
    orderNote: 'Call on arrival',
    createdAt: AT,
    processingOrderId: PROCESSING_ORDER_ID,
    processingStartedAt: AT,
    processingExpiresAt: instant('2026-09-08T22:00:00.000Z'),
    ...overrides,
  };
}

function workspace(): OrdersWorkspace {
  return {
    shopId: SHOP_ID,
    businessDayId: DAY_ID,
    configuration: CONFIGURATION,
    operator: { id: WORKER_ID, displayName: 'Current Worker' },
    draft: {
      shopId: SHOP_ID,
      businessDayId: DAY_ID,
      draftScopeId: 'online-order-context',
      revision: 0,
      updatedAt: AT,
      checkoutIntentKey: 'unused-context-intent',
      orderTypeId: TAKE_AWAY_ID,
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

const runtime = {
  now: () => AT,
  createUuid: vi.fn(() => 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
};

describe('prepareOnlineOrderAcceptanceDraft', () => {
  it('builds a worker-confirmed DELIVERY draft from a live PROCESSING request', () => {
    const draft = prepareOnlineOrderAcceptanceDraft({
      request: request(),
      workspace: workspace(),
      confirmation: {
        orderTypeId: DELIVERY_ID,
        deliveryZoneId: ZONE_ID,
        finalDeliveryFeeMinor: moneyMinor(2_500),
        payment: {
          mode: 'SINGLE',
          methodId: CASH_ID,
          cashReceivedMinor: moneyMinor(25_000),
        },
      },
      runtime,
    });

    expect(draft.checkoutIntentKey).toBe(REQUEST_ID);
    expect(draft.draftScopeId).toBe(`online-order:${REQUEST_ID}`);
    expect(draft.businessDayId).toBe(DAY_ID);
    expect(draft.orderTypeId).toBe(DELIVERY_ID);
    expect(draft.lines).toEqual([
      expect.objectContaining({
        productId: PRODUCT_ID,
        productName: 'Online Burger',
        unitPriceMinor: moneyMinor(19_000),
        quantity: 1,
        itemNote: 'No onions',
      }),
    ]);
    expect(draft.delivery).toEqual({
      displayPhone: '01012345678',
      normalizedPhone: '01012345678',
      customerName: 'Online Customer',
      address: 'Nasr City, Cairo',
      zoneId: ZONE_ID,
      zoneLabel: 'Nasr City',
      configuredFeeMinor: moneyMinor(3_000),
      finalFeeMinor: moneyMinor(2_500),
    });
    expect(draft.payment).toEqual({
      mode: 'SINGLE',
      methodId: CASH_ID,
      cashReceivedMinor: moneyMinor(25_000),
    });
  });

  it('refuses stale trusted prices instead of silently accepting an old catalog snapshot', () => {
    expect(() =>
      prepareOnlineOrderAcceptanceDraft({
        request: request({
          trustedItems: [
            {
              productId: PRODUCT_ID,
              productName: 'Online Burger',
              unitPriceMinor: 18_000,
              quantity: 1,
              modifiers: [],
              comboBeverage: null,
              note: null,
            },
          ],
          itemsSubtotalMinor: 18_000,
        }),
        workspace: workspace(),
        confirmation: {
          orderTypeId: DELIVERY_ID,
          deliveryZoneId: ZONE_ID,
          finalDeliveryFeeMinor: moneyMinor(3_000),
          payment: { mode: 'SINGLE', methodId: CASH_ID, cashReceivedMinor: moneyMinor(25_000) },
        },
        runtime,
      }),
    ).toThrow(/catalog|price/i);
  });

  it('blocks finalization when fulfillment or delivery authority is missing', () => {
    expect(() =>
      prepareOnlineOrderAcceptanceDraft({
        request: request(),
        workspace: workspace(),
        confirmation: {
          orderTypeId: TAKE_AWAY_ID,
          deliveryZoneId: null,
          finalDeliveryFeeMinor: null,
          payment: { mode: 'SINGLE', methodId: CASH_ID, cashReceivedMinor: moneyMinor(25_000) },
        },
        runtime,
      }),
    ).toThrow(/fulfillment|delivery/i);
  });
});

describe('OperationsOnlineOrderAcceptanceService', () => {
  it('places through OperationsOrdersService authority with the reserved processing order id', async () => {
    const placement = { ok: true as const, value: { order: { id: PROCESSING_ORDER_ID } } };
    const orders = {
      loadWorkspace: vi.fn().mockResolvedValue({ ok: true, value: workspace() }),
      placeOrder: vi.fn().mockResolvedValue(placement),
    };
    const service = new OperationsOnlineOrderAcceptanceService(orders, runtime);

    await expect(
      service.accept(request(), {
        orderTypeId: DELIVERY_ID,
        deliveryZoneId: ZONE_ID,
        finalDeliveryFeeMinor: moneyMinor(2_500),
        payment: {
          mode: 'SINGLE',
          methodId: CASH_ID,
          cashReceivedMinor: moneyMinor(25_000),
        },
      }),
    ).resolves.toBe(placement);

    expect(orders.loadWorkspace).toHaveBeenCalledWith(`online-order:${REQUEST_ID}`);
    expect(orders.placeOrder).toHaveBeenCalledWith(
      expect.objectContaining({ checkoutIntentKey: REQUEST_ID }),
      { source: 'ONLINE', orderId: PROCESSING_ORDER_ID },
    );
  });
});
