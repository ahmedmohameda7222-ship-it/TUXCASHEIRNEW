import { ADMIN_REPORT_AREAS } from '@tux/admin-contracts';
import { describe, expect, it } from 'vitest';
import { REPORT_LABELS, REPORT_TOPICS } from './ReportFilters';
import { chooseReportArea } from './reportAreaTransition';
import type { ReportFilters } from './useReports';

describe('report topic picker', () => {
  it('groups each supported report exactly once with the original report ID', () => {
    const grouped = REPORT_TOPICS.flatMap((topic) => topic.areas);
    expect(grouped.length).toBe(Object.keys(REPORT_LABELS).length);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect(new Set(grouped)).toEqual(new Set(Object.keys(REPORT_LABELS)));
  });
});

describe('selected report-first contract', () => {
  it('exposes all 22 canonical report areas and no staff sales leaderboard', () => {
    const grouped = REPORT_TOPICS.flatMap((topic) => [...topic.areas]);
    expect(grouped).toHaveLength(22);
    expect([...grouped].sort()).toEqual([...ADMIN_REPORT_AREAS].sort());
    expect(Object.keys(REPORT_LABELS).sort()).toEqual([...ADMIN_REPORT_AREAS].sort());
    expect(grouped).not.toContain('employee-sales-leaderboard');
  });

  it('clears incompatible context, source and pagination when changing reports', () => {
    const filters: ReportFilters = {
      area: 'customers',
      fromDate: '2026-10-01',
      toDate: '2026-10-26',
      source: 'ONLINE',
      shopIds: ['shop-a'],
      comparePrevious: true,
      context: { customerId: 'customer-a', orderTypeId: 'type-a' },
      offset: 200,
    };
    expect(chooseReportArea(filters, 'purchasing')).toMatchObject({
      area: 'purchasing',
      source: null,
      context: {},
      offset: 0,
      fromDate: filters.fromDate,
      toDate: filters.toDate,
      shopIds: filters.shopIds,
      comparePrevious: true,
    });
    expect(chooseReportArea(filters, 'customers')).toBe(filters);
  });
});
