import {
  instant,
  moneyMinor,
  parseEntityId,
  type BusinessDayId,
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
import { prepareOnlineOrderAcceptanceDraft } from './onlineOrderAcceptance';

const SHOP_ID = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const DAY_ID = parseEntityId<BusinessDayId>('22222222-2222-4222-8222-222222222222');
const WORKER_ID = parseEntityId<WorkerId>('33333333-3333-4333-8333-333333333333');
const CATEGORY_ID = parseEntityId<MenuCategoryId>('44444444-4444-4444-8444-444444444444');
const PRODUCT_ID = parseEntityId<ProductId>('55555555-5555-4555-8555-555555555555');
const TAKE_AWAY_ID = parseEntityId<OrderTypeId>('66666666-6666-4666-8666-666666666666');
const CASH_ID = parseEntityId<PaymentMethodId>('99999999-9999-4999-8999-999999999999');
const AT = instant('2026-09-14T01:00:00.000Z');

function configuration(): OperationsConfigurationSnapshot {
  return {
    shopId: SHOP_ID,
    version: 12,
    updatedAt: AT,
    categories: [{ id: CATEGORY_ID, shopId: SHOP_ID, name: 'Burgers', sortOrder: 0, active: true }],
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
        channel: 'BOTH',
      },
    ],
    deliveryZones: [],
    settings: {
      version: 7,
      values: { 'checkout.requireCustomerPhone': true },
      shopIdentity: {
        shopId: SHOP_ID,
        displayName: 'TUX',
        address: null,
        phone: null,
        latitude: null,
        longitude: null,
        timezone: 'Africa/Cairo',
        lifecycleState: 'ACTIVE',
        temporaryClosed: false,
        onlineOrdersPaused: false,
      },
      weeklyHours: [],
      specialHours: [],
      paymentMethodZoneRules: [],
    },
  };
}

function workspace(): OrdersWorkspace {
  return {
    shopId: SHOP_ID,
    businessDayId: DAY_ID,
    configuration: configuration(),
    operator: { id: WORKER_ID, displayName: 'Worker' },
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

function request(): CachedOnlineOrderRequest {
  return {
    requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    shopId: SHOP_ID,
    status: 'PROCESSING',
    catalogRevision: 'a'.repeat(64),
    fulfillmentPreference: 'PICKUP',
    paymentPreference: 'CASH',
    customerName: 'Pickup Customer',
    normalizedPhone: '01012345678',
    deliveryAddress: null,
    trustedItems: [
      {
        productId: PRODUCT_ID,
        productName: 'Online Burger',
        unitPriceMinor: 19_000,
        quantity: 1,
        modifiers: [],
        comboBeverage: null,
        note: null,
      },
    ],
    itemsSubtotalMinor: 19_000,
    orderNote: null,
    createdAt: AT,
    processingOrderId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    processingStartedAt: AT,
    processingExpiresAt: instant('2026-09-14T02:00:00.000Z'),
    processingDeviceId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    reservationOriginDeviceId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  };
}

describe('pickup customer-phone acceptance', () => {
  it('carries the normalized pickup phone into the Operations draft when required', () => {
    const draft = prepareOnlineOrderAcceptanceDraft({
      request: request(),
      workspace: workspace(),
      confirmation: {
        orderTypeId: TAKE_AWAY_ID,
        deliveryZoneId: null,
        finalDeliveryFeeMinor: null,
        payment: {
          mode: 'SINGLE',
          methodId: CASH_ID,
          cashReceivedMinor: moneyMinor(19_000),
        },
      },
      runtime: {
        now: () => AT,
        createUuid: vi.fn(() => 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
      },
    });

    expect(draft.delivery.displayPhone).toBe('01012345678');
    expect(draft.delivery.normalizedPhone).toBe('01012345678');
  });
});
