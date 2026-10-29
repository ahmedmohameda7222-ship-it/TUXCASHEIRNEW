import { describe, expect, it } from 'vitest';

import { staffSummaryMetrics } from './staffSummaryMetrics';

const currentShop = 'shop-a';
const rows = [
  { active: true, pinConfigured: false },
  { active: false, pinConfigured: false },
  { active: true, pinConfigured: true },
];

describe('Staff directory summary', () => {
  it('counts authorized complete shop rows only, including readiness for the selected shop', () => {
    const metrics = staffSummaryMetrics(rows, currentShop, true, 4);
    expect(metrics.map((metric) => metric.label)).toEqual([
      'Employees',
      'Active staff',
      'PIN required',
      'Pending leave',
    ]);
    expect(metrics.map((metric) => metric.value)).toEqual([3, 2, 1, 4]);
  });

  it('does not present paginated partial rows as full-shop totals', () => {
    const metrics = staffSummaryMetrics(rows, currentShop, false, 4);
    expect(metrics.slice(0, 3).every((metric) => metric.value === null)).toBe(true);
    expect(metrics[3]?.value).toBe(4);
  });
});
