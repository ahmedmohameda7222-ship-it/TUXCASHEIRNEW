import { describe, expect, it } from 'vitest';

import { expectedOrderValueMinor, formatExpectedOrderValue } from './purchaseOrderValue';

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
    expect(expectedOrderValueMinor([
      { orderedPurchaseUnitsMicros: 1_000_000, expectedPurchaseUnitCostMinor: 1.25 },
    ])).toBeNull();
    expect(formatExpectedOrderValue(null)).toBe('Unavailable');
  });

  it('preserves deliberately free supplier items without inventing nonzero costs', () => {
    expect(formatExpectedOrderValue(expectedOrderValueMinor([
      { orderedPurchaseUnitsMicros: 500_000, expectedPurchaseUnitCostMinor: 0 },
    ]))).toBe('0.00 EGP');
  });
});
