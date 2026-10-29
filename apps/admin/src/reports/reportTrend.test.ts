import { describe, expect, it } from 'vitest';
import { completeReportDailyActivity } from './reportTrend';
import type { ReportResponse, ReportFilters } from './useReports';

const filters: ReportFilters = {
  area: 'sales',
  fromDate: '2026-10-28',
  toDate: '2026-10-29',
  source: null,
  shopIds: ['shop-a'],
  comparePrevious: false,
  offset: 0,
};
const entry = (id: string, occurredAt: string) => ({
  id,
  shopId: 'shop-a',
  occurredAt,
  label: 'Actual sale',
  amountMinor: 500,
  sourceKind: 'payment',
  quantity: 1,
  orderSource: 'POS' as const,
  costMissing: false,
  drilldown: null,
});
const report: ReportResponse = {
  ok: true,
  area: 'sales',
  summary: {
    eventCount: 2,
    orderCount: 2,
    totalAmountMinor: 1000,
    totalQuantity: 2,
    incompleteCostEvents: 0,
    coverageNote: null,
  },
  rows: [entry('1', '2026-10-28T22:30:00.000Z'), entry('2', '2026-10-29T12:00:00.000Z')],
  nextOffset: null,
};

describe('R1 truthful report trend', () => {
  it('buckets complete source records by Cairo business date', () => {
    expect(completeReportDailyActivity(report, filters)).toEqual([
      { date: '2026-10-28', count: 0 },
      { date: '2026-10-29', count: 2 },
    ]);
  });
  it('never presents first-page activity as a complete trend', () => {
    expect(completeReportDailyActivity({ ...report, nextOffset: 50 }, filters)).toBeNull();
    expect(
      completeReportDailyActivity(
        { ...report, summary: { ...report.summary, eventCount: 100 } },
        filters,
      ),
    ).toBeNull();
    expect(completeReportDailyActivity(report, { ...filters, offset: 50 })).toBeNull();
  });
  it('returns unavailable on longer ranges to prevent unbounded day chart rendering', () => {
    expect(completeReportDailyActivity(report, { ...filters, fromDate: '2020-01-01' })).toBeNull();
  });
  it('does not label a mismatched canonical source date as zero activity', () => {
    const outOfWindow = {
      ...report,
      rows: [entry('1', '2026-10-19T12:00:00.000Z'), entry('2', '2026-10-19T14:00:00.000Z')],
    };
    expect(completeReportDailyActivity(outOfWindow, filters)).toBeNull();
  });
});
