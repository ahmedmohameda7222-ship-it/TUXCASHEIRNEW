import { describe, expect, it } from 'vitest';

import { projectPublishedCheckoutAuthority } from './published-checkout-authority';

const shopId = '11111111-1111-4111-8111-111111111111';
const methodId = '22222222-2222-4222-8222-222222222222';
const zoneId = '33333333-3333-4333-8333-333333333333';

const publishedBundle = {
  snapshot: {
    shopId,
    version: 10,
    updatedAt: '2026-10-11T21:00:00.000Z',
    categories: [],
    products: [],
    modifiers: [],
    productModifierLinks: [],
    comboBeverageOptions: [],
    recipeLines: [],
    orderTypes: [],
    paymentMethods: [
      {
        id: methodId,
        shopId,
        displayName: 'Cash',
        logicType: 'CASH',
        requiresReconciliation: true,
        active: true,
        sortOrder: 10,
        channel: 'ONLINE',
        requiresReference: false,
        manualConfirmationRequired: false,
        refundAllowed: true,
        integrationReference: null,
      },
    ],
    deliveryZones: [
      {
        id: zoneId,
        shopId,
        name: 'Maadi',
        feeMinor: 2500,
        active: true,
        sortOrder: 10,
      },
    ],
    settings: {
      version: 4,
      values: {},
      shopIdentity: {
        shopId,
        displayName: 'TUX Maadi',
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
      paymentMethodZoneRules: [
        { paymentMethodId: methodId, deliveryZoneId: zoneId, allowed: false },
      ],
    },
    reasonCodes: [],
  },
  inventoryItems: [],
};

describe('published Admin checkout restrictions consumed by online order intake', () => {
  it('projects published payment-zone restrictions from the Operations bundle', () => {
    const authority = projectPublishedCheckoutAuthority(publishedBundle, shopId);
    expect(authority.shopId).toBe(shopId);
    expect(authority.configurationVersion).toBe(10);
    expect(authority.settingsVersion).toBe(4);
    expect(authority.paymentMethods).toHaveLength(1);
    expect(authority.paymentMethodZoneRules).toEqual([
      { paymentMethodId: methodId, deliveryZoneId: zoneId, allowed: false },
    ]);
  });

  it('rejects a published bundle for a different shop before interpreting its policy', () => {
    const wrongShopId = '44444444-4444-4444-8444-444444444444';
    expect(() => projectPublishedCheckoutAuthority(publishedBundle, wrongShopId)).toThrow(
      /different shop/i,
    );
  });
});
