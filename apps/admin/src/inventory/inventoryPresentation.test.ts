import { describe, expect, it } from 'vitest';
import {
  inventoryCounts,
  inventoryDisplayRows,
  inventoryStatus,
  trackingModeLabel,
} from './inventoryPresentation';

const item = (name: string, availableMicros: number, threshold: number | null, active = true) => ({
  id: name,
  name,
  availableMicros,
  lowStockThresholdMicros: threshold,
  active,
  trackingMode: 'RECIPE_TRACKED',
  unitLabel: 'kg',
  onHandMicros: availableMicros,
  reservedMicros: 0,
});

describe('Inventory presentation from authorized shop balances', () => {
  it('distinguishes archive, out, low, unconfigured and in-stock', () => {
    expect(inventoryStatus(item('out', 0, null))).toBe('OUT_OF_STOCK');
    expect(inventoryStatus(item('low', 2_000_000, 2_000_000))).toBe('LOW_STOCK');
    expect(inventoryStatus(item('notConfigured', 3_000_000, null))).toBe('UNCONFIGURED');
    expect(inventoryStatus(item('in', 3_000_000, 2_000_000))).toBe('IN_STOCK');
    expect(inventoryStatus(item('archived', 0, 0, false))).toBe('ARCHIVED');
  });

  it('uses the actual recipe tracking values, not fictitious batch and serial labels', () => {
    expect(trackingModeLabel('RECIPE_TRACKED')).toBe('Recipe tracked');
    expect(trackingModeLabel('BULK_MANUAL')).toBe('Bulk / manual');
  });

  it('calculates status counts over the full shop scope, excluding archived alerts', () => {
    const rows = [
      item('One', 0, 1),
      item('Two', 1_000_000, 2_000_000),
      item('Three', 4_000_000, null),
      item('Old', 0, 1, false),
    ];
    expect(inventoryCounts(rows)).toEqual({
      total: 4,
      inStock: 0,
      lowStock: 1,
      outOfStock: 1,
      unconfigured: 1,
      archived: 1,
    });
  });

  it('searches, sorts and paginates without mixing stock units or inventing totals', () => {
    const rows = [
      item('Banana', 1_000_000, 0),
      item('Apple', 2_000_000, 0),
      item('Apricot', 3_000_000, 0),
    ];
    expect(inventoryDisplayRows(rows, 'ap', 'all', 'name', 1, 1).rows.map((x) => x.name)).toEqual([
      'Apple',
    ]);
    expect(inventoryDisplayRows(rows, 'ap', 'all', 'name', 2, 1).rows.map((x) => x.name)).toEqual([
      'Apricot',
    ]);
    expect(
      inventoryDisplayRows(rows, '', 'all', 'available-desc', 1, 2).rows.map((x) => x.name),
    ).toEqual(['Apricot', 'Apple']);
  });
});
