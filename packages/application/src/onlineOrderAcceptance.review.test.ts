import {
  instant,
  moneyMinor,
  parseEntityId,
  type BusinessDayId,
  type DeliveryZoneId,
  type MenuCategoryId,
  type ModifierId,
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
const OTHER_SHOP_ID = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111112');
const DAY_ID = parseEntityId<BusinessDayId>('22222222-2222-4222-8222-222222222222');
const WORKER_ID = parseEntityId<WorkerId>('33333333-3333-4333-8333-333333333333');
const CATEGORY_ID = parseEntityId<MenuCategoryId>('44444444-4444-4444-8444-444444444444');
const PRODUCT_ID = parseEntityId<ProductId>('55555555-5555-4555-8555-555555555555');
const MODIFIER_ID = parseEntityId<ModifierId>('55555555-5555-4555-8555-555555555556');
const TAKE_AWAY_ID = parseEntityId<OrderTypeId>('66666666-6666-4666-8666-666666666666');
const DELIVERY_ID = parseEntityId<OrderTypeId>('77777777-7777-4777-8777-777777777777');
const ZONE_ID = parseEntityId<DeliveryZoneId>('88888888-8888-4888-8888-888888888888');
const CASH_ID = parseEntityId<PaymentMethodId>('99999999-9999-4999-8999-999999999999');
const REQUEST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROCESSING_ORDER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const AT = instant('2026-09-08T16:00:00.000Z');

function configuration(): OperationsConfigurationSnapshot {
  return {
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
    modifiers: [
      {
        id: MODIFIER_ID,
        shopId: SHOP_ID,
        name: 'Extra cheese',
        priceMinor: moneyMinor(2_000),
        standaloneProductId: null,
        active: true,
        sortOrder: 0,
      },
    ],
    productModifierLinks: [
      {
        shopId: SHOP_ID,
        productId: PRODUCT_ID,
        modifierId: MODIFIER_ID,
        maxQuantity: 2,
        sortOrder: 0,
      },
    ],
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
}

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
        modifiers: [
          {
            modifierId: MODIFIER_ID,
            label: 'Extra cheese',
            unitPriceMinor: 2_000,
            quantity: 1,
          },
        ],
        comboBeverage: null,
        note: null,
      },
    ],
    itemsSubtotalMinor: 21_000,
    orderNote: null,
    createdAt: AT,
    processingOrderId: PROCESSING_ORDER_ID,
    processingStartedAt: AT,
    processingExpiresAt: instant('2026-09-08T22:00:00.000Z'),
    ...overrides,
  };
}

function workspace(config = configuration()): OrdersWorkspace {
  return {
    shopId: SHOP_ID,
    businessDayId: DAY_ID,
    configuration: config,
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

const cashPayment = {
  mode: 'SINGLE' as const,
  methodId: CASH_ID,
  cashReceivedMinor: moneyMinor(30_000),
};

function deliveryConfirmation() {
  return {
    orderTypeId: DELIVERY_ID,
    deliveryZoneId: ZONE_ID,
    finalDeliveryFeeMinor: moneyMinor(3_000),
    payment: cashPayment,
  };
}

describe('online-order acceptance reviewed authority', () => {
  it('builds a successful worker-confirmed PICKUP draft without delivery facts', () => {
    const pickup = request({
      fulfillmentPreference: 'PICKUP',
      normalizedPhone: null,
      deliveryAddress: null,
    });
    const draft = prepareOnlineOrderAcceptanceDraft({
      request: pickup,
      workspace: workspace(),
      confirmation: {
        orderTypeId: TAKE_AWAY_ID,
        deliveryZoneId: null,
        finalDeliveryFeeMinor: null,
        payment: cashPayment,
      },
      runtime,
    });

    expect(draft.orderTypeId).toBe(TAKE_AWAY_ID);
    expect(draft.checkoutIntentKey).toBe(REQUEST_ID);
    expect(draft.delivery.zoneId).toBeNull();
    expect(draft.delivery.finalFeeMinor).toBe(moneyMinor(0));
  });

  it.each([
    [
      'PENDING request',
      request({
        status: 'PENDING',
        processingOrderId: null,
        processingStartedAt: null,
        processingExpiresAt: null,
      }),
      /processing|claim/i,
    ],
    [
      'expired PROCESSING request',
      request({ processingExpiresAt: AT }),
      /expired|claim|processing/i,
    ],
    ['cross-shop request', request({ shopId: OTHER_SHOP_ID }), /shop|tenant/i],
  ])('rejects %s before placement', async (_label, candidate, message) => {
    const placeOrder = vi.fn();
    const orders = {
      loadWorkspace: vi.fn().mockResolvedValue({ ok: true, value: workspace() }),
      placeOrder,
    };
    const service = new OperationsOnlineOrderAcceptanceService(orders, runtime);

    await expect(service.accept(candidate, deliveryConfirmation())).rejects.toThrow(message);
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it('rejects a changed trusted modifier price', () => {
    const stale = request({
      trustedItems: [
        {
          productId: PRODUCT_ID,
          productName: 'Online Burger',
          unitPriceMinor: 19_000,
          quantity: 1,
          modifiers: [
            {
              modifierId: MODIFIER_ID,
              label: 'Extra cheese',
              unitPriceMinor: 1_500,
              quantity: 1,
            },
          ],
          comboBeverage: null,
          note: null,
        },
      ],
      itemsSubtotalMinor: 20_500,
    });

    expect(() =>
      prepareOnlineOrderAcceptanceDraft({
        request: stale,
        workspace: workspace(),
        confirmation: deliveryConfirmation(),
        runtime,
      }),
    ).toThrow(/modifier|catalog|price/i);
  });

  it.each(['inactive', 'unlinked'] as const)('rejects an %s modifier authority', (mode) => {
    const config = configuration();
    const changed: OperationsConfigurationSnapshot = {
      ...config,
      modifiers:
        mode === 'inactive'
          ? config.modifiers.map((modifier) => ({ ...modifier, active: false }))
          : config.modifiers,
      productModifierLinks: mode === 'unlinked' ? [] : config.productModifierLinks,
    };

    expect(() =>
      prepareOnlineOrderAcceptanceDraft({
        request: request(),
        workspace: workspace(changed),
        confirmation: deliveryConfirmation(),
        runtime,
      }),
    ).toThrow(/modifier|catalog|unavailable|link/i);
  });

  it('rejects a trusted subtotal inconsistent with reconstructed canonical lines', () => {
    expect(() =>
      prepareOnlineOrderAcceptanceDraft({
        request: request({ itemsSubtotalMinor: 20_999 }),
        workspace: workspace(),
        confirmation: deliveryConfirmation(),
        runtime,
      }),
    ).toThrow(/subtotal|total|catalog|price/i);
  });

  it.each(['inactive', 'sold-out'] as const)('rejects an %s product', (mode) => {
    const config = configuration();
    const changed: OperationsConfigurationSnapshot = {
      ...config,
      products: config.products.map((product) => ({
        ...product,
        active: mode === 'inactive' ? false : product.active,
        soldOut: mode === 'sold-out' ? true : product.soldOut,
      })),
    };

    expect(() =>
      prepareOnlineOrderAcceptanceDraft({
        request: request(),
        workspace: workspace(changed),
        confirmation: deliveryConfirmation(),
        runtime,
      }),
    ).toThrow(/product|catalog|unavailable|sold/i);
  });

  it('rejects missing worker-confirmed payment authority', () => {
    expect(() =>
      prepareOnlineOrderAcceptanceDraft({
        request: request(),
        workspace: workspace(),
        confirmation: {
          ...deliveryConfirmation(),
          payment: { mode: 'NONE' },
        },
        runtime,
      }),
    ).toThrow(/payment/i);
  });

  it('rejects an invalid worker-confirmed cash allocation', () => {
    expect(() =>
      prepareOnlineOrderAcceptanceDraft({
        request: request(),
        workspace: workspace(),
        confirmation: {
          ...deliveryConfirmation(),
          payment: {
            mode: 'SINGLE',
            methodId: CASH_ID,
            cashReceivedMinor: moneyMinor(1_000),
          },
        },
        runtime,
      }),
    ).toThrow(/payment|cash|received/i);
  });
});
