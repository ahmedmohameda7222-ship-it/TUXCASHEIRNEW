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
import { describe, expect, it } from 'vitest';
import type { OrdersWorkspace } from './orders';
import { prepareOnlineOrderAcceptanceDraft } from './onlineOrderAcceptance';

const SHOP_ID = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const DAY_ID = parseEntityId<BusinessDayId>('22222222-2222-4222-8222-222222222222');
const WORKER_ID = parseEntityId<WorkerId>('33333333-3333-4333-8333-333333333333');
const CATEGORY_ID = parseEntityId<MenuCategoryId>('44444444-4444-4444-8444-444444444444');
const PRODUCT_ID = parseEntityId<ProductId>('55555555-5555-4555-8555-555555555555');
const TAKE_AWAY_ID = parseEntityId<OrderTypeId>('66666666-6666-4666-8666-666666666666');
const CASH_ID = parseEntityId<PaymentMethodId>('77777777-7777-4777-8777-777777777777');
const AT = instant('2026-09-08T16:00:00.000Z');

const configuration: OperationsConfigurationSnapshot = {
  shopId: SHOP_ID,
  version: 1,
  updatedAt: AT,
  categories: [
    {
      id: CATEGORY_ID,
      shopId: SHOP_ID,
      name: 'Burgers',
      sortOrder: 0,
      active: false,
    },
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
};

const request: CachedOnlineOrderRequest = {
  requestId: '88888888-8888-4888-8888-888888888888',
  shopId: SHOP_ID,
  status: 'PROCESSING',
  catalogRevision: 'a'.repeat(64),
  fulfillmentPreference: 'PICKUP',
  paymentPreference: 'CASH',
  customerName: 'Online Customer',
  normalizedPhone: null,
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
  processingOrderId: '99999999-9999-4999-8999-999999999999',
  processingStartedAt: AT,
  processingExpiresAt: instant('2026-09-08T22:00:00.000Z'),
};

const workspace: OrdersWorkspace = {
  shopId: SHOP_ID,
  businessDayId: DAY_ID,
  configuration,
  operator: { id: WORKER_ID, displayName: 'Current Worker' },
  draft: {
    shopId: SHOP_ID,
    businessDayId: DAY_ID,
    draftScopeId: 'online-order-category-test',
    revision: 0,
    updatedAt: AT,
    checkoutIntentKey: 'unused',
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

const runtime = {
  now: () => AT,
  createUuid: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
};

describe('online-order category authority', () => {
  it('rejects a requested product whose current canonical category is inactive', () => {
    expect(() =>
      prepareOnlineOrderAcceptanceDraft({
        request,
        workspace,
        confirmation: {
          orderTypeId: TAKE_AWAY_ID,
          deliveryZoneId: null,
          finalDeliveryFeeMinor: null,
          payment: {
            mode: 'SINGLE',
            methodId: CASH_ID,
            cashReceivedMinor: moneyMinor(20_000),
          },
        },
        runtime,
      }),
    ).toThrow(/category|catalog|unavailable/i);
  });
});
