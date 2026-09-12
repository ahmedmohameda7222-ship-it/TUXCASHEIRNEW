import { describe, expect, it } from 'vitest';

import { projectPublishedPublicOrdering } from './published-ordering';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_SHOP_ID = '99999999-9999-4999-8999-999999999999';
const TAKEAWAY_ID = '22222222-2222-4222-8222-222222222221';
const DELIVERY_ID = '22222222-2222-4222-8222-222222222222';
const DINE_IN_ID = '22222222-2222-4222-8222-222222222223';
const CASH_ID = '33333333-3333-4333-8333-333333333331';
const INSTAPAY_ID = '33333333-3333-4333-8333-333333333332';
const CARD_ID = '33333333-3333-4333-8333-333333333333';

function bundle(options: { lifecycleState?: 'ACTIVE' | 'SUSPENDED'; withSettings?: boolean } = {}) {
  const withSettings = options.withSettings ?? true;
  return {
    snapshot: {
      shopId: SHOP_ID,
      version: 12,
      updatedAt: '2026-09-12T00:00:00.000Z',
      categories: [],
      products: [],
      modifiers: [],
      productModifierLinks: [],
      comboBeverageOptions: [],
      recipeLines: [],
      orderTypes: [
        {
          id: TAKEAWAY_ID,
          shopId: SHOP_ID,
          name: 'Take away',
          behavior: 'TAKE_AWAY',
          active: true,
          sortOrder: 2,
        },
        {
          id: DELIVERY_ID,
          shopId: SHOP_ID,
          name: 'Delivery',
          behavior: 'DELIVERY',
          active: true,
          sortOrder: 1,
        },
        {
          id: DINE_IN_ID,
          shopId: SHOP_ID,
          name: 'Dine in',
          behavior: 'DINE_IN',
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
          requiresReconciliation: false,
          active: true,
          sortOrder: 1,
          channel: 'BOTH',
          requiresReference: false,
          manualConfirmationRequired: false,
          refundAllowed: true,
          integrationReference: null,
        },
        {
          id: INSTAPAY_ID,
          shopId: SHOP_ID,
          displayName: 'InstaPay',
          logicType: 'DIGITAL',
          requiresReconciliation: true,
          active: true,
          sortOrder: 2,
          channel: 'ONLINE',
          requiresReference: true,
          manualConfirmationRequired: true,
          refundAllowed: true,
          integrationReference: 'INSTAPAY',
        },
        {
          id: CARD_ID,
          shopId: SHOP_ID,
          displayName: 'Card terminal',
          logicType: 'CARD',
          requiresReconciliation: true,
          active: true,
          sortOrder: 3,
          channel: 'POS',
          requiresReference: false,
          manualConfirmationRequired: false,
          refundAllowed: true,
          integrationReference: 'provider-secret-name',
        },
      ],
      deliveryZones: [],
      reasonCodes: [],
      ...(withSettings
        ? {
            settings: {
              version: 7,
              values: {
                'checkout.minimumOrderMinor': 3000,
                'checkout.serviceChargeBps': 500,
                'checkout.taxBps': 1400,
              },
              shopIdentity: {
                shopId: SHOP_ID,
                displayName: 'TUX Maadi',
                address: 'Road 9, Maadi',
                phone: '+201000000000',
                latitude: 29.9602,
                longitude: 31.2569,
                timezone: 'Africa/Cairo',
                lifecycleState: options.lifecycleState ?? 'ACTIVE',
                temporaryClosed: false,
                onlineOrdersPaused: false,
              },
              weeklyHours: [],
              specialHours: [],
              paymentMethodZoneRules: [],
            },
          }
        : {}),
    },
    inventoryItems: [],
  };
}

describe('published catalog-public ordering projection', () => {
  it('derives only customer-safe shop identity and supported browser checkout preferences', () => {
    const projection = projectPublishedPublicOrdering(bundle(), SHOP_ID);

    expect(projection).toEqual({
      shop: {
        displayName: 'TUX Maadi',
        address: 'Road 9, Maadi',
        phone: '+201000000000',
        latitude: 29.9602,
        longitude: 31.2569,
      },
      ordering: {
        available: true,
        temporaryClosed: false,
        onlineOrdersPaused: false,
        minimumOrderMinor: 3000,
        serviceChargeBps: 500,
        taxBps: 1400,
        fulfillmentPreferences: ['PICKUP', 'DELIVERY'],
        paymentPreferences: ['CASH', 'INSTAPAY', 'MIXED'],
      },
    });

    expect(JSON.stringify(projection)).not.toContain('provider-secret-name');
    expect(JSON.stringify(projection)).not.toContain('integrationReference');
  });

  it('marks non-active published shops unavailable without leaking lifecycle internals', () => {
    const projection = projectPublishedPublicOrdering(
      bundle({ lifecycleState: 'SUSPENDED' }),
      SHOP_ID,
    );
    expect(projection.ordering.available).toBe(false);
    expect(JSON.stringify(projection)).not.toContain('SUSPENDED');
  });

  it('fails closed when V2 has no published settings identity', () => {
    expect(() => projectPublishedPublicOrdering(bundle({ withSettings: false }), SHOP_ID)).toThrow(
      /published settings/i,
    );
  });

  it('fails closed on a cross-shop published bundle', () => {
    expect(() => projectPublishedPublicOrdering(bundle(), OTHER_SHOP_ID)).toThrow(
      /different shop/i,
    );
  });
});
