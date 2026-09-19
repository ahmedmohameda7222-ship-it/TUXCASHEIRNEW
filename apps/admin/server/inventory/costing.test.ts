import { describe, expect, it } from 'vitest';

import {
  calculateRecipeCost,
  calculateWeightedAverageCost,
} from './costing';

describe('Admin inventory costing', () => {
  it('calculates weighted average cost', () => {
    expect(
      calculateWeightedAverageCost(
        { quantity: 10_000, unitCostMinor: 20 },
        { quantity: 10_000, unitCostMinor: 24 },
      ),
    ).toBe(22);
  });

  it('preserves fractional weighted average precision', () => {
    expect(
      calculateWeightedAverageCost(
        { quantity: 3, unitCostMinor: 10 },
        { quantity: 1, unitCostMinor: 11 },
      ),
    ).toBe(10.25);
  });

  it('calculates recipe cost from base-micro usage and per-base-unit costs', () => {
    expect(
      calculateRecipeCost([
        { quantityMicros: 500_000, unitCostMinor: 200 },
        { quantityMicros: 250_000, unitCostMinor: 400 },
      ]),
    ).toBe(200);
  });
});
