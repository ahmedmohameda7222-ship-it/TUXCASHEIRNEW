import type { AdminSessionPrincipal } from '@tux/admin-contracts';
import { describe, expect, it } from 'vitest';

import { collectAuthorizedReportExport } from './reportPdfExport';

const shop = '11111111-1111-4111-8111-111111111111';
const principal: AdminSessionPrincipal = {
  businessId: '22222222-2222-4222-8222-222222222222',
  employeeId: '33333333-3333-4333-8333-333333333333',
  role: 'STAFF',
  permissions: ['reports.view'],
  shopIds: [shop],
};
const request = {
  kind: 'current' as const,
  area: 'sales' as const,
  shopIds: [shop],
  fromDate: '2026-10-01',
  toDate: '2026-10-31',
  source: null,
  context: {},
};

describe('R3 canonical full-record export collector', () => {
  it('includes row 120 even though the interactive report only shows 50 per page', async () => {
    const offsets: number[] = [];
    const result = await collectAuthorizedReportExport(request, principal, async (args) => {
      offsets.push(args.offset);
      const rows = Array.from({ length: Math.min(100, 120 - args.offset) }, (_, index) => ({
        id: `record-${args.offset + index + 1}`,
        shopId: shop,
        occurredAt: '2026-10-29T09:00:00.000Z',
        label: 'Payment',
        sourceKind: 'payment',
        amountMinor: 123,
        quantity: 1,
        costMissing: false,
      }));
      return {
        ok: true,
        summary: {
          eventCount: 120,
          orderCount: 120,
          totalAmountMinor: 14760,
          totalQuantity: 120,
          incompleteCostEvents: 0,
          coverageNote: null,
        },
        rows,
        nextOffset: args.offset + rows.length < 120 ? args.offset + rows.length : null,
      };
    });
    expect(offsets).toEqual([0, 100]);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]?.rows).toHaveLength(120);
    expect(result.sections[0]?.rows.at(-1)?.id).toBe('record-120');
    expect(result.sections[0]?.summary.totalAmountMinor).toBe(14760);
  });

  it('omits finance and staff sections when only reports.view is granted', async () => {
    const seen: string[] = [];
    const result = await collectAuthorizedReportExport(
      { ...request, kind: 'all-authorized' },
      principal,
      async (args) => {
        seen.push(args.area);
        return {
          ok: true,
          summary: {
            eventCount: 0,
            orderCount: 0,
            totalAmountMinor: 0,
            totalQuantity: 0,
            incompleteCostEvents: 0,
            coverageNote: null,
          },
          rows: [],
          nextOffset: null,
        };
      },
    );
    expect(result.sections.map((section) => section.area)).toEqual(['sales', 'shop-comparison']);
    expect(seen).toEqual(['sales', 'shop-comparison']);
    expect(result.sections).toHaveLength(2);
  });

  it('retains server-calculated comparison summary for the prior equivalent window', async () => {
    const calls: Array<{ fromDate: string; toDate: string; pageSize: number }> = [];
    const result = await collectAuthorizedReportExport(
      { ...request, fromDate: '2026-10-21', toDate: '2026-10-27', comparePrevious: true, comparisonRange: 'previous' },
      principal,
      async (args) => {
        calls.push({ fromDate: args.fromDate, toDate: args.toDate, pageSize: args.pageSize });
        const comparison = args.pageSize === 1;
        return {
          ok: true,
          summary: { eventCount: comparison ? 1 : 0, orderCount: 0, totalAmountMinor: comparison ? -500 : 0, totalQuantity: 0, incompleteCostEvents: 0, coverageNote: null },
          rows: [],
          nextOffset: null,
        };
      },
    );
    expect(calls).toEqual([
      { fromDate: '2026-10-21', toDate: '2026-10-27', pageSize: 100 },
      { fromDate: '2026-10-14', toDate: '2026-10-20', pageSize: 1 },
    ]);
    expect(result.sections[0]?.comparison?.summary.totalAmountMinor).toBe(-500);
  });

  it('rejects requests for an unauthorized shop before making any backend query', async () => {
    let queried = false;
    await expect(
      collectAuthorizedReportExport(
        { ...request, shopIds: ['44444444-4444-4444-8444-444444444444'] },
        principal,
        async () => {
          queried = true;
          throw new Error('should_not_query');
        },
      ),
    ).rejects.toThrow();
    expect(queried).toBe(false);
  });

  it('refuses oversized exports rather than returning a partial PDF as complete', async () => {
    await expect(
      collectAuthorizedReportExport(request, principal, async () => ({
        ok: true,
        summary: {
          eventCount: 999999,
          orderCount: 999999,
          totalAmountMinor: 999999,
          totalQuantity: 999999,
          incompleteCostEvents: 0,
          coverageNote: null,
        },
        rows: [],
        nextOffset: 100,
      })),
    ).rejects.toThrow('report_export_too_large');
  });
});
