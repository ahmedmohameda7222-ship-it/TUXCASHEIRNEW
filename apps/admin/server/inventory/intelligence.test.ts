import { describe, expect, it } from 'vitest';

import {
  calculateInventoryUsageVariance,
  calculateRecipeMarginAlert,
  suggestOrderQuantity,
} from './intelligence';

describe('inventory intelligence', () => {
  it('subtracts incoming stock from the par shortage without subtracting reservations twice', () => {
    expect(
      suggestOrderQuantity({
        available: 6_000,
        par: 15_000,
        incoming: 2_000,
        minimumOrder: null,
        orderMultiple: null,
      }),
    ).toBe(7_000);
  });

  it('rounds a reorder suggestion to the supplier order multiple', () => {
    expect(
      suggestOrderQuantity({
        available: 6_000,
        par: 15_000,
        incoming: 2_000,
        minimumOrder: 4_000,
        orderMultiple: 2_000,
      }),
    ).toBe(8_000);
  });

  it('applies the supplier minimum only when a reorder is actually needed', () => {
    expect(
      suggestOrderQuantity({
        available: 13_500,
        par: 15_000,
        incoming: 0,
        minimumOrder: 4_000,
        orderMultiple: 2_000,
      }),
    ).toBe(4_000);

    expect(
      suggestOrderQuantity({
        available: 13_500,
        par: 15_000,
        incoming: 1_500,
        minimumOrder: 4_000,
        orderMultiple: 2_000,
      }),
    ).toBe(0);
  });

  it('reports actual versus theoretical usage for the same period', () => {
    expect(
      calculateInventoryUsageVariance({
        actualUsageMicros: 12_000_000,
        theoreticalUsageMicros: 10_000_000,
      }),
    ).toEqual({
      actualUsageMicros: 12_000_000,
      theoreticalUsageMicros: 10_000_000,
      varianceMicros: 2_000_000,
      variancePercent: 20,
    });
  });

  it('handles a zero theoretical baseline without inventing a percentage', () => {
    expect(
      calculateInventoryUsageVariance({
        actualUsageMicros: 500_000,
        theoreticalUsageMicros: 0,
      }),
    ).toEqual({
      actualUsageMicros: 500_000,
      theoreticalUsageMicros: 0,
      varianceMicros: 500_000,
      variancePercent: null,
    });
  });

  it('raises a food-cost margin alert and ranks ingredient contributors', () => {
    expect(
      calculateRecipeMarginAlert({
        sellingPriceMinor: 10_000,
        targetCostPercent: 30,
        alertThresholdPercentagePoints: 3,
        ingredients: [
          { inventoryItemId: 'beef', name: 'Beef', costMinor: 2_400 },
          { inventoryItemId: 'bun', name: 'Bun', costMinor: 700 },
          { inventoryItemId: 'sauce', name: 'Sauce', costMinor: 400 },
        ],
      }),
    ).toEqual({
      recipeCostMinor: 3_500,
      currentCostPercent: 35,
      targetCostPercent: 30,
      overTargetPercentagePoints: 5,
      alert: true,
      contributors: [
        { inventoryItemId: 'beef', name: 'Beef', costMinor: 2_400, sharePercent: 68.57 },
        { inventoryItemId: 'bun', name: 'Bun', costMinor: 700, sharePercent: 20 },
        { inventoryItemId: 'sauce', name: 'Sauce', costMinor: 400, sharePercent: 11.43 },
      ],
    });
  });
});
