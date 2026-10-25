import { describe, expect, it } from 'vitest';

import {
  expectedOrderValueMinor,
  formatExpectedOrderValue,
  purchaseOrderDisplayReference,
} from './purchaseOrderValue';

describe('accurate expected Purchase Order value', () => {
  it('uses purchase-unit quantity micros and exact minor-unit monetary rounding', () => {
    const result = expectedOrderValueMinor([
      { orderedPurchaseUnitsMicros: 1_500_000, expectedPurchaseUnitCostMinor: 12345 },
      { orderedPurchaseUnitsMicros: 1_000_000, expectedPurchaseUnitCostMinor: 10000 },
    ]);
    expect(result).toBe(28518);
    expect(formatExpectedOrderValue(result)).toBe('285.18 EGP');
  });

  it('does not invent a total for empty, invalid, or nonrepresentable lines', () => {
    expect(expectedOrderValueMinor([])).toBeNull();
    expect(
      expectedOrderValueMinor([
        { orderedPurchaseUnitsMicros: 1_000_000, expectedPurchaseUnitCostMinor: 1.25 },
      ]),
    ).toBeNull();
    expect(formatExpectedOrderValue(null)).toBe('Unavailable');
  });

  it('preserves deliberately free supplier items without inventing nonzero costs', () => {
    expect(
      formatExpectedOrderValue(
        expectedOrderValueMinor([
          { orderedPurchaseUnitsMicros: 500_000, expectedPurchaseUnitCostMinor: 0 },
        ]),
      ),
    ).toBe('0.00 EGP');
  });
});

describe('safe purchase order display references', () => {
  const id = '11111111-1111-4111-8111-111111111111';

  it('uses stored supplier reference exactly when available', () => {
    expect(purchaseOrderDisplayReference({ id, reference: '  SUP-42  ' })).toBe('SUP-42');
  });

  it('derives stable opaque labels from canonical identity when reference is missing', () => {
    const identity = { id, reference: null };
    const label = purchaseOrderDisplayReference(identity);
    expect(label).toMatch(/^PO-[0-9A-Z]{13}$/);
    expect(label).toBe(purchaseOrderDisplayReference(identity));
    expect(label).not.toContain('11111111');
    expect(
      purchaseOrderDisplayReference({
        id: '22222222-2222-4222-8222-222222222222',
        reference: null,
      }),
    ).not.toBe(label);
  });
});
