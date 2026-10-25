import { describe, expect, it } from 'vitest';

import { scopeReportFilters } from './reportScope';
import type { ReportFilters } from './useReports';

const filters: ReportFilters = {
  area: 'sales',
  fromDate: '2026-10-01',
  toDate: '2026-10-26',
  source: 'POS',
  shopIds: ['shop-a'],
  comparePrevious: false,
  context: { customerId: 'customer-a' },
  offset: 150,
};

describe('report shop scope transitions', () => {
  it('does not request a former shop when the authorized single-shop selector changes', () => {
    expect(
      scopeReportFilters(filters, { kind: 'shop', shopId: 'shop-b' }, ['shop-a', 'shop-b'], true),
    ).toMatchObject({ shopIds: ['shop-b'], context: {}, offset: 0 });
  });

  it('clears former-shop context when switching into all-shops', () => {
    expect(
      scopeReportFilters(filters, { kind: 'all-shops' }, ['shop-a', 'shop-b'], true),
    ).toMatchObject({ shopIds: ['shop-a', 'shop-b'], context: {}, offset: 0 });
  });

  it('preserves deliberate authorized subsets while remaining in all-shops', () => {
    const result = scopeReportFilters(
      { ...filters, shopIds: ['shop-b'], offset: 50 },
      { kind: 'all-shops' },
      ['shop-a', 'shop-b'],
      false,
    );
    expect(result.shopIds).toEqual(['shop-b']);
    expect(result.offset).toBe(50);
    expect(result.context).toEqual({ customerId: 'customer-a' });
  });

  it('preserves deliberate authorized cross-shop comparison for an Owner', () => {
    const result = scopeReportFilters(
      { ...filters, shopIds: ['shop-a', 'shop-b'] },
      { kind: 'shop', shopId: 'shop-a' },
      ['shop-a', 'shop-b'],
      false,
      true,
    );
    expect(result.shopIds).toEqual(['shop-a', 'shop-b']);
  });

  it('never allows unauthorized stored report selections into a request', () => {
    expect(
      scopeReportFilters({ ...filters, shopIds: ['shop-a', 'foreign-shop'] },
        { kind: 'all-shops' }, ['shop-a'], false).shopIds,
    ).toEqual(['shop-a']);
    expect(
      scopeReportFilters(filters, { kind: 'shop', shopId: 'foreign-shop' }, ['shop-a'], true)
        .shopIds,
    ).toEqual([]);
  });
});
