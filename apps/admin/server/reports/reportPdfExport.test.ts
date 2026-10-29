import type { AdminSessionPrincipal } from '@tux/admin-contracts';
import { ADMIN_REPORT_AREAS } from '@tux/admin-contracts';
import { describe, expect, it, vi } from 'vitest';

import { collectAuthorizedReportExport, ReportExportError } from './reportPdfExport.js';

const shopId = '11111111-1111-4111-8111-111111111111';
const otherShop = '22222222-2222-4222-8222-222222222222';
const staff: AdminSessionPrincipal = {
  businessId: '33333333-3333-4333-8333-333333333333',
  employeeId: '44444444-4444-4444-8444-444444444444',
  role: 'STAFF',
  permissions: ['reports.view', 'catalog.view'],
  shopIds: [shopId],
};

function summary(count: number) {
  return {
    eventCount: count,
    orderCount: count,
    totalAmountMinor: -2500,
    totalQuantity: count,
    incompleteCostEvents: 1,
    coverageNote: 'Unit costs missing for some rows',
  };
}
function fact(index: number) {
  return {
    id: `report-${index}`,
    shopId,
    sourceKind: 'refund',
    occurredAt: '2026-10-29T12:00:00Z',
    label: `Record ${index}`,
    amountMinor: -100,
    quantity: 1,
    orderSource: 'POS',
    costMissing: index === 0,
    drilldown: null,
  };
}

describe('Reports complete authorized reader', () => {
  it('reads the final row past 50 visible records and keeps canonical signed summary', async () => {
    const query = vi.fn(async (args: { p_offset: number; p_page_limit: number }) => ({
      ok: true as const,
      summary: summary(120),
      rows: Array.from({ length: Math.min(100, 120 - args.p_offset) }, (_, index) =>
        fact(args.p_offset + index),
      ),
      nextOffset: args.p_offset + args.p_page_limit < 120 ? args.p_offset + 100 : null,
    }));
    const result = await collectAuthorizedReportExport({
      kind: 'current',
      area: 'sales',
      principal: staff,
      shopIds: [shopId],
      fromDate: '2026-10-01',
      toDate: '2026-10-29',
      source: 'POS',
      context: {},
      query,
    });
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]?.rows).toHaveLength(120);
    expect(result.sections[0]?.rows.at(-1)?.label).toBe('Record 119');
    expect(result.sections[0]?.summary.totalAmountMinor).toBe(-2500);
    expect(result.sections[0]?.summary.incompleteCostEvents).toBe(1);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('retrieves 1,200 source records across 12 backend pages without dropping the last record', async () => {
    const count = 1200;
    const query = vi.fn(async (args: { p_offset: number; p_page_limit: number }) => ({
      ok: true as const,
      summary: {
        ...summary(count),
        incompleteCostEvents: 0,
        coverageNote: null,
      },
      rows: Array.from(
        { length: Math.min(args.p_page_limit, Math.max(0, count - args.p_offset)) },
        (_, index) => ({ ...fact(args.p_offset + index), costMissing: false }),
      ),
      nextOffset:
        args.p_offset + args.p_page_limit < count
          ? args.p_offset + args.p_page_limit
          : null,
    }));
    const result = await collectAuthorizedReportExport({
      kind: 'current',
      area: 'sales',
      principal: staff,
      shopIds: [shopId],
      fromDate: '2026-10-01',
      toDate: '2026-10-29',
      source: null,
      context: {},
      query,
    });
    expect(result.sections[0]?.rows).toHaveLength(count);
    expect(result.sections[0]?.rows.at(-1)?.id).toBe('report-1199');
    expect(query).toHaveBeenCalledTimes(12);
  });

  it('full export uses canonical 22-domain order but never queries unauthorized areas', async () => {
    const queried: string[] = [];
    const query = vi.fn(
      async (args: { p_area: string; p_context: Record<string, unknown>; p_source: unknown }) => {
        queried.push(args.p_area);
        expect(args.p_context).toEqual({});
        expect(args.p_source).toBeNull();
        return { ok: true as const, summary: summary(0), rows: [], nextOffset: null };
      },
    );
    const result = await collectAuthorizedReportExport({
      kind: 'all-authorized',
      area: 'sales',
      principal: staff,
      shopIds: [shopId],
      fromDate: '2026-10-01',
      toDate: '2026-10-29',
      source: 'ONLINE',
      context: { customerId: 'private-customer' },
      query,
    });
    expect(queried).toEqual(['sales', 'products', 'shop-comparison']);
    expect(result.sections.map((section) => section.area)).toEqual(queried);
    expect(result.totalCanonicalAreas).toBe(ADMIN_REPORT_AREAS.length);
    expect(result.skippedUnauthorizedCount).toBe(19);
  });

  it('denies cross-shop access before any report RPC runs', async () => {
    const query = vi.fn();
    await expect(
      collectAuthorizedReportExport({
        kind: 'current',
        area: 'sales',
        principal: staff,
        shopIds: [otherShop],
        fromDate: '2026-10-01',
        toDate: '2026-10-29',
        context: {},
        source: null,
        query,
      }),
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects reversed ranges and oversized reports rather than returning a partial download', async () => {
    const query = vi.fn(async (args: { p_offset: number }) => ({
      ok: true as const,
      summary: summary(20_100),
      rows: Array.from({ length: 100 }, (_, i) => fact(i + args.p_offset)),
      nextOffset: args.p_offset + 100,
    }));
    const base = {
      kind: 'current' as const,
      area: 'sales' as const,
      principal: staff,
      shopIds: [shopId],
      source: null,
      context: {},
      query,
    };
    await expect(
      collectAuthorizedReportExport({
        ...base,
        fromDate: '2026-10-29',
        toDate: '2026-10-01',
      }),
    ).rejects.toMatchObject({ code: 'report_export_range_invalid' });
    expect(query).not.toHaveBeenCalled();
    await expect(
      collectAuthorizedReportExport({
        ...base,
        fromDate: '2026-10-01',
        toDate: '2026-10-29',
      }),
    ).rejects.toBeInstanceOf(ReportExportError);
  });
  it('preserves the server-equivalent previous window in a current-report export', async () => {
    const calls: string[] = [];
    const query = vi.fn(async (args: { p_start_date: string }) => {
      calls.push(args.p_start_date);
      return { ok: true as const, summary: summary(0), rows: [], nextOffset: null };
    });
    const data = await collectAuthorizedReportExport({
      kind: 'current',
      area: 'sales',
      principal: staff,
      shopIds: [shopId],
      fromDate: '2026-10-22',
      toDate: '2026-10-29',
      source: null,
      context: {},
      compare: 'previous',
      query,
    });
    expect(calls).toEqual(['2026-10-22', '2026-10-14']);
    expect(data.comparison).toMatchObject({
      periodStart: '2026-10-14',
      periodEnd: '2026-10-21',
    });
  });
});
