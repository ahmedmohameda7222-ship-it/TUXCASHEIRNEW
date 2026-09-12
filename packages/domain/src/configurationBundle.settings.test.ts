import { describe, expect, it } from 'vitest';

import { parseOperationsConfigurationBundle } from './configurationBundle';

const shopId = '11111111-1111-4111-8111-111111111111';
const paymentMethodId = '22222222-2222-4222-8222-222222222222';
const deliveryZoneId = '33333333-3333-4333-8333-333333333333';
const reasonCodeId = '44444444-4444-4444-8444-444444444444';

function bundle(
  options: { readonly withSettings?: boolean; readonly paymentChannel?: string } = {},
) {
  const withSettings = options.withSettings ?? true;
  return {
    snapshot: {
      shopId,
      version: 9,
      updatedAt: '2026-09-11T20:00:00.000Z',
      categories: [],
      products: [],
      modifiers: [],
      productModifierLinks: [],
      comboBeverageOptions: [],
      recipeLines: [],
      orderTypes: [],
      paymentMethods: [
        {
          id: paymentMethodId,
          shopId,
          displayName: 'Card',
          logicType: 'CARD',
          requiresReconciliation: true,
          active: true,
          sortOrder: 0,
          ...(withSettings
            ? {
                channel: options.paymentChannel ?? 'ONLINE',
                requiresReference: true,
                manualConfirmationRequired: false,
                refundAllowed: true,
                integrationReference: 'stripe-main',
              }
            : {}),
        },
      ],
      deliveryZones: [
        {
          id: deliveryZoneId,
          shopId,
          name: 'Maadi',
          feeMinor: 2500,
          active: true,
          sortOrder: 0,
        },
      ],
      ...(withSettings
        ? {
            settings: {
              version: 4,
              values: {
                'checkout.minimumOrderMinor': 1500,
                'checkout.serviceChargeBps': 500,
                'checkout.taxBps': 1400,
                'receipt.footer': 'Thank you',
                'receipt.orderPrefix': 'MD-',
              },
              shopIdentity: {
                shopId,
                displayName: 'TUX Maadi',
                address: 'Road 9',
                phone: '+201000000000',
                latitude: 29.9602,
                longitude: 31.2569,
                timezone: 'Africa/Cairo',
                lifecycleState: 'ACTIVE',
                temporaryClosed: false,
                onlineOrdersPaused: false,
              },
              weeklyHours: [
                {
                  id: '55555555-5555-4555-8555-555555555555',
                  serviceKind: 'OPEN',
                  dayOfWeek: 5,
                  timezone: 'Africa/Cairo',
                  opensLocal: '10:00:00',
                  closesLocal: '02:00:00',
                  active: true,
                },
              ],
              specialHours: [],
              paymentMethodZoneRules: [
                {
                  paymentMethodId,
                  deliveryZoneId,
                  allowed: false,
                },
              ],
            },
            reasonCodes: [
              {
                id: reasonCodeId,
                key: 'customer-request',
                family: 'CANCELLATION',
                label: 'Customer request',
                active: true,
                version: 2,
                scope: 'BUSINESS',
              },
            ],
          }
        : {}),
    },
    inventoryItems: [],
  };
}

describe('Operations published settings configuration', () => {
  it('preserves trusted checkout, payment, receipt, hours, and reason-code settings', () => {
    const parsed = parseOperationsConfigurationBundle(bundle());

    expect(parsed.snapshot.settings?.version).toBe(4);
    expect(parsed.snapshot.settings?.values['checkout.minimumOrderMinor']).toBe(1500);
    expect(parsed.snapshot.settings?.shopIdentity.displayName).toBe('TUX Maadi');
    expect(parsed.snapshot.settings?.weeklyHours[0]).toMatchObject({
      dayOfWeek: 5,
      opensLocal: '10:00:00',
      closesLocal: '02:00:00',
    });
    expect(parsed.snapshot.settings?.paymentMethodZoneRules[0]).toMatchObject({
      paymentMethodId,
      deliveryZoneId,
      allowed: false,
    });
    expect(parsed.snapshot.paymentMethods[0]).toMatchObject({
      channel: 'ONLINE',
      requiresReference: true,
      manualConfirmationRequired: false,
      refundAllowed: true,
      integrationReference: 'stripe-main',
    });
    expect(parsed.snapshot.reasonCodes?.[0]).toMatchObject({
      id: reasonCodeId,
      family: 'CANCELLATION',
      label: 'Customer request',
      version: 2,
    });
  });

  it('keeps legacy Operations configuration compatible with safe payment defaults', () => {
    const parsed = parseOperationsConfigurationBundle(bundle({ withSettings: false }));

    expect(parsed.snapshot.settings).toBeNull();
    expect(parsed.snapshot.reasonCodes).toEqual([]);
    expect(parsed.snapshot.paymentMethods[0]).toMatchObject({
      channel: 'BOTH',
      requiresReference: false,
      manualConfirmationRequired: false,
      refundAllowed: true,
      integrationReference: null,
    });
  });

  it('rejects malformed channel and cross-reference settings instead of dropping them', () => {
    expect(() =>
      parseOperationsConfigurationBundle(bundle({ paymentChannel: 'WHATSAPP' })),
    ).toThrow(/payment method channel/i);

    const invalidZoneRule = bundle();
    if (!invalidZoneRule.snapshot.settings) throw new Error('settings fixture must be present');
    invalidZoneRule.snapshot.settings.paymentMethodZoneRules[0]!.deliveryZoneId =
      '99999999-9999-4999-8999-999999999999';
    expect(() => parseOperationsConfigurationBundle(invalidZoneRule)).toThrow(
      /payment method zone rule delivery zone/i,
    );
  });
});
