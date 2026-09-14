import { describe, expect, it } from 'vitest';

import type { OperationsConfigurationSnapshot } from './catalog';
import { resolveEffectiveCheckoutPolicy } from './checkoutPolicy';
import { parseEntityId, type ShopId } from './ids';
import { moneyMinor } from './money';
import type { OrderDraft } from './orderDraft';
import { validateOrderDraft } from './orderValidation';
import { instant } from './time';

const SHOP_ID = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222' as never;
const CATEGORY_ID = '33333333-3333-4333-8333-333333333333' as never;
const ORDER_TYPE_ID = '44444444-4444-4444-8444-444444444444' as never;
const PAYMENT_METHOD_ID = '55555555-5555-4555-8555-555555555555' as never;

function configuration(value: unknown): OperationsConfigurationSnapshot {
  return {
    shopId: SHOP_ID,
    version: 12,
    updatedAt: instant('2026-09-12T20:00:00.000Z'),
    categories: [],
    products: [],
    modifiers: [],
    productModifierLinks: [],
    comboBeverageOptions: [],
    recipeLines: [],
    orderTypes: [],
    paymentMethods: [],
    deliveryZones: [],
    settings: {
      version: 7,
      values: { 'checkout.allowDiscountStacking': value as never },
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
    reasonCodes: [],
  };
}

function pickupConfiguration(requireCustomerPhone: unknown): OperationsConfigurationSnapshot {
  const base = configuration(false);
  return {
    ...base,
    products: [
      {
        id: PRODUCT_ID,
        shopId: SHOP_ID,
        categoryId: CATEGORY_ID,
        name: 'Burger',
        description: null,
        priceMinor: moneyMinor(1_000),
        imageKey: null,
        active: true,
        soldOut: false,
        isCombo: false,
        sortOrder: 1,
      },
    ],
    orderTypes: [
      {
        id: ORDER_TYPE_ID,
        shopId: SHOP_ID,
        name: 'Take Away',
        behavior: 'TAKE_AWAY',
        active: true,
        sortOrder: 1,
      },
    ],
    paymentMethods: [
      {
        id: PAYMENT_METHOD_ID,
        shopId: SHOP_ID,
        displayName: 'Cash',
        logicType: 'CASH',
        requiresReconciliation: true,
        active: true,
        sortOrder: 1,
        channel: 'BOTH',
      },
    ],
    settings: base.settings
      ? {
          ...base.settings,
          values: { 'checkout.requireCustomerPhone': requireCustomerPhone as never },
        }
      : null,
  };
}

function pickupDraft(displayPhone: string): OrderDraft {
  return {
    shopId: SHOP_ID,
    businessDayId: '66666666-6666-4666-8666-666666666666' as never,
    draftScopeId: 'customer-phone-policy',
    revision: 1,
    updatedAt: instant('2026-09-12T20:00:00.000Z'),
    checkoutIntentKey: '77777777-7777-4777-8777-777777777777',
    orderTypeId: ORDER_TYPE_ID,
    lines: [
      {
        id: '88888888-8888-4888-8888-888888888888' as never,
        productId: PRODUCT_ID,
        productName: 'Burger',
        unitPriceMinor: moneyMinor(1_000),
        quantity: 1,
        modifiers: [],
        comboBeverages: [],
        itemNote: null,
        addedSequence: 1,
      },
    ],
    orderNote: null,
    discountMinor: moneyMinor(0),
    delivery: {
      displayPhone,
      normalizedPhone: '',
      customerName: '',
      address: '',
      zoneId: null,
      zoneLabel: '',
      configuredFeeMinor: moneyMinor(0),
      finalFeeMinor: moneyMinor(0),
    },
    payment: {
      mode: 'SINGLE',
      methodId: PAYMENT_METHOD_ID,
      cashReceivedMinor: moneyMinor(1_000),
    },
  };
}

describe('published checkout policy', () => {
  it('resolves the published discount-stacking boolean into the effective checkout policy', () => {
    expect(resolveEffectiveCheckoutPolicy(configuration(true)).allowDiscountStacking).toBe(true);
    expect(resolveEffectiveCheckoutPolicy(configuration(false)).allowDiscountStacking).toBe(false);
  });

  it('defaults an absent discount-stacking setting to false for additive rollout compatibility', () => {
    const legacy = configuration(false);
    const withoutSetting: OperationsConfigurationSnapshot = {
      ...legacy,
      settings: legacy.settings ? { ...legacy.settings, values: {} } : null,
    };
    expect(resolveEffectiveCheckoutPolicy(withoutSetting).allowDiscountStacking).toBe(false);
  });

  it('fails closed when the discount-stacking setting is present but malformed', () => {
    expect(() => resolveEffectiveCheckoutPolicy(configuration('yes'))).toThrow(
      /checkout\.allowDiscountStacking/i,
    );
  });

  it('resolves and validates the published customer-phone requirement', () => {
    expect(resolveEffectiveCheckoutPolicy(pickupConfiguration(true)).requireCustomerPhone).toBe(
      true,
    );
    expect(resolveEffectiveCheckoutPolicy(pickupConfiguration(false)).requireCustomerPhone).toBe(
      false,
    );
    expect(() => resolveEffectiveCheckoutPolicy(pickupConfiguration('yes'))).toThrow(
      /checkout\.requireCustomerPhone/i,
    );
  });

  it('requires a valid phone for POS pickup only when the published policy enables it', () => {
    const required = validateOrderDraft(pickupDraft(''), pickupConfiguration(true));
    expect(required.valid).toBe(false);
    if (required.valid) throw new Error('pickup unexpectedly passed without required phone');
    expect(required.issues.map((issue) => issue.code)).toContain('CUSTOMER_PHONE_REQUIRED');

    expect(validateOrderDraft(pickupDraft('01012345678'), pickupConfiguration(true)).valid).toBe(
      true,
    );
    expect(validateOrderDraft(pickupDraft(''), pickupConfiguration(false)).valid).toBe(true);
  });
});
