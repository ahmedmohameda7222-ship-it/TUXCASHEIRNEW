import { describe, expect, it } from 'vitest';

import {
  calculateActualVsTheoretical,
  calculateFoodCostMarginAlert,
  suggestOrderQuantity,
} from './intelligence';

describe('inventory intelligence', () => {
  it('subtracts incoming stock from the par-level reorder shortage', () => {
    expect(
      suggestOrderQuantity({
        available: 6_000,
        par: 15_000,
        incoming: 2_000,
      }),
    ).toBe(7_000);
  });

  it('does not subtract reservations twice because available is already on-hand minus reserved', () => {
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

  it('rounds a supplier-aware reorder suggestion to the configured order multiple', () => {
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

  it('honors the supplier minimum order before rounding to an order multiple', () => {
    expect(
      suggestOrderQuantity({
        available: 13_000,
        par: 15_000,
        incoming: 0,
        minimumOrder: 4_000,
        orderMultiple: 2_000,
      }),
    ).toBe(4_000);
  });

  it('returns zero when available plus incoming already meets the par target', () => {
    expect(
      suggestOrderQuantity({
        available: 13_000,
        par: 15_000,
        incoming: 2_000,
        minimumOrder: 4_000,
        orderMultiple: 2_000,
      }),
    ).toBe(0);
  });

  it('reports actual versus theoretical usage without treating reservations as usage', () => {
    expect(
      calculateActualVsTheoretical({
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
      calculateActualVsTheoretical({
        actualUsageMicros: 2_000_000,
        theoreticalUsageMicros: 0,
      }),
    ).toEqual({
      actualUsageMicros: 2_000_000,
      theoreticalUsageMicros: 0,
      varianceMicros: 2_000_000,
      variancePercent: null,
    });
  });

  it('raises a food-cost margin alert and identifies the largest ingredient contributor', () => {
    expect(
      calculateFoodCostMarginAlert({
        productPriceMinor: 20_000,
        targetFoodCostPercent: 30,
        alertThresholdPercent: 35,
        ingredients: [
          { inventoryItemId: 'beef', itemName: 'Beef', costMinor: 5_000 },
          { inventoryItemId: 'bun', itemName: 'Bun', costMinor: 900 },
          { inventoryItemId: 'sauce', itemName: 'Sauce', costMinor: 1_300 },
        ],
      }),
    ).toEqual({
      recipeCostMinor: 7_200,
      foodCostPercent: 36,
      targetFoodCostPercent: 30,
      alertThresholdPercent: 35,
      alert: true,
      largestContributor: {
        inventoryItemId: 'beef',
        itemName: 'Beef',
        costMinor: 5_000,
      },
    });
  });

  it('does not alert when current food cost remains below the configured threshold', () => {
    const result = calculateFoodCostMarginAlert({
      productPriceMinor: 20_000,
      targetFoodCostPercent: 30,
      alertThresholdPercent: 35,
      ingredients: [{ inventoryItemId: 'beef', itemName: 'Beef', costMinor: 5_000 }],
    });
    expect(result.alert).toBe(false);
    expect(result.foodCostPercent).toBe(25);
  });
});
