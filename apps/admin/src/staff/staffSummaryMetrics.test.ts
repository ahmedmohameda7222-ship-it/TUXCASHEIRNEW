import { describe, expect, it } from 'vitest';

import { staffSummaryMetrics } from './staffSummaryMetrics';

const currentShop = 'shop-a';
const rows = [
  { active: true, operationsSetupRequiredShopIds: ['shop-a'] },
  { active: false, operationsSetupRequiredShopIds: [] },
  { active: true, operationsSetupRequiredShopIds: ['shop-b'] },
];

describe('Staff directory summary', () => {
  it('counts authorized complete shop rows only, including readiness for the selected shop', () => {
    const metrics = staffSummaryMetrics(rows, currentShop, true);
    expect(metrics.map((metric) => metric.label)).toEqual([
      'Employees',
      'Active staff',
      'Setup required',
      'Pending leave',
    ]);
    expect(metrics.map((metric) => metric.value)).toEqual([3, 2, 1, null]);
  });

  it('does not present paginated partial rows or unavailable leave aggregates as full totals', () => {
    const metrics = staffSummaryMetrics(rows, currentShop, false);
    expect(metrics.every((metric) => metric.value === null)).toBe(true);
  });
});
