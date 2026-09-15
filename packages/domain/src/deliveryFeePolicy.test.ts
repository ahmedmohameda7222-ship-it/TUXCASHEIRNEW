import { describe, expect, it } from 'vitest';
import type { OperationsConfigurationSnapshot } from './catalog';
import type { OrderDraft } from './orderDraft';
import { moneyMinor } from './money';
import { validateOrderDraft } from './orderValidation';

const shopId = '10000000-0000-4000-8000-000000000001' as never;
const categoryId = '11000000-0000-4000-8000-000000000001' as never;
const productId = '12000000-0000-4000-8000-000000000001' as never;
const lineId = '13000000-0000-4000-8000-000000000001' as never;
const orderTypeId = '20000000-0000-4000-8000-000000000001' as never;
const zoneId = '30000000-0000-4000-8000-000000000001' as never;
const paymentMethodId = '31000000-0000-4000-8000-000000000001' as never;

function config(allowDeliveryFeeOverride?: boolean): OperationsConfigurationSnapshot {
  return {
    shopId,
    version: 9,
    updatedAt: '2026-09-13T00:00:00.000Z' as never,
    categories: [],
    products: [
      {
        id: productId,
        shopId,
        categoryId,
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
    modifiers: [],
    productModifierLinks: [],
    comboBeverageOptions: [],
    recipeLines: [],
    orderTypes: [
      {
        id: orderTypeId,
        shopId,
        name: 'Delivery',
        behavior: 'DELIVERY',
        active: true,
        sortOrder: 1,
      },
    ],
    paymentMethods: [
      {
        id: paymentMethodId,
        shopId,
        displayName: 'Cash',
        logicType: 'CASH',
        requiresReconciliation: true,
        active: true,
        sortOrder: 1,
        channel: 'BOTH',
      },
    ],
    deliveryZones: [
      {
        id: zoneId,
        shopId,
        name: 'Zone',
        feeMinor: moneyMinor(2_000),
        active: true,
        sortOrder: 1,
      },
    ],
    settings: {
      version: 4,
      values:
        allowDeliveryFeeOverride === undefined
          ? {}
          : { 'checkout.allowDeliveryFeeOverride': allowDeliveryFeeOverride },
    } as never,
    reasonCodes: [],
  };
}

function draft(finalFeeMinor: number, configuredFeeMinor = 2_000): OrderDraft {
  return {
    shopId,
    businessDayId: '40000000-0000-4000-8000-000000000001' as never,
    draftScopeId: 'delivery-fee-policy',
    revision: 1,
    updatedAt: '2026-09-13T00:00:00.000Z' as never,
    checkoutIntentKey: '50000000-0000-4000-8000-000000000001',
    orderTypeId,
    lines: [
      {
        id: lineId,
        productId,
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
      displayPhone: '01012345678',
      normalizedPhone: '01012345678',
      customerName: 'Customer',
      address: 'Address',
      zoneId,
      zoneLabel: 'Zone',
      configuredFeeMinor: moneyMinor(configuredFeeMinor),
      finalFeeMinor: moneyMinor(finalFeeMinor),
    },
    payment: {
      mode: 'SINGLE',
      methodId: paymentMethodId,
      cashReceivedMinor: moneyMinor(4_000),
    },
  };
}

function issueCodes(result: ReturnType<typeof validateOrderDraft>): string[] {
  return result.valid ? [] : result.issues.map((issue) => issue.code);
}

describe('delivery fee override authority', () => {
  it('fails closed when the policy is absent', () => {
    expect(issueCodes(validateOrderDraft(draft(3_000), config()))).toContain(
      'DELIVERY_FEE_OVERRIDE_NOT_ALLOWED',
    );
  });

  it('rejects a fee different from the configured zone fee when override policy is disabled', () => {
    expect(issueCodes(validateOrderDraft(draft(3_000), config(false)))).toContain(
      'DELIVERY_FEE_OVERRIDE_NOT_ALLOWED',
    );
  });

  it('allows a manual delivery fee only when the published policy enables it', () => {
    expect(validateOrderDraft(draft(3_000), config(true)).valid).toBe(true);
  });

  it('rejects a stale draft configured fee even when overrides are enabled', () => {
    expect(issueCodes(validateOrderDraft(draft(3_000, 1_500), config(true)))).toContain(
      'DELIVERY_ZONE_FEE_STALE',
    );
  });
});
