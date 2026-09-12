import { describe, expect, it } from 'vitest';

import { resolveEffectiveCheckoutPolicy } from './checkoutPolicy';
import { parseEntityId, type ShopId } from './ids';
import type { OperationsConfigurationSnapshot } from './catalog';
import { instant } from './time';

const SHOP_ID = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');

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

describe('published checkout discount-stacking policy', () => {
  it('resolves the published boolean into the effective checkout policy', () => {
    expect(resolveEffectiveCheckoutPolicy(configuration(true)).allowDiscountStacking).toBe(true);
    expect(resolveEffectiveCheckoutPolicy(configuration(false)).allowDiscountStacking).toBe(false);
  });

  it('defaults an absent setting to false for additive rollout compatibility', () => {
    const legacy = configuration(false);
    const withoutSetting: OperationsConfigurationSnapshot = {
      ...legacy,
      settings: legacy.settings
        ? { ...legacy.settings, values: {} }
        : null,
    };
    expect(resolveEffectiveCheckoutPolicy(withoutSetting).allowDiscountStacking).toBe(false);
  });

  it('fails closed when the published setting is present but malformed', () => {
    expect(() => resolveEffectiveCheckoutPolicy(configuration('yes'))).toThrow(
      /checkout\.allowDiscountStacking/i,
    );
  });
});
