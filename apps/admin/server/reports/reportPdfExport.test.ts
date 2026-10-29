import type { AdminSessionPrincipal } from '@tux/admin-contracts';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
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
  it('has no runtime imports from source-only Admin contracts in serverless Node ESM', () => {
    const source = readFileSync(new URL('./reportPdfExport.ts', import.meta.url), 'utf8');
    const output = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        verbatimModuleSyntax: true,
      },
    }).outputText;
    expect(output).not.toMatch(/from ['"]@tux\/admin-contracts['"]/);
  });


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

  it('R5 reads the full 1,001 authorized records over 11 bounded RPC batches', async () => {
    const total = 1001;
    const offsets: number[] = [];
    const result = await collectAuthorizedReportExport(request, principal, async (args) => {
      offsets.push(args.offset);
      const size = Math.min(100, total - args.offset);
      return {
        ok: true,
        summary: {
          eventCount: total,
          orderCount: 1,
          totalAmountMinor: -2500,
          totalQuantity: total,
          incompleteCostEvents: 0,
          coverageNote: null,
        },
        rows: Array.from({ length: size }, (_, index) => ({
          id: 'event-' + (args.offset + index + 1),
          shopId: shop,
          occurredAt: '2026-10-29T09:00:00.000Z',
          label: 'Refund',
          sourceKind: 'refund',
          amountMinor: -2500,
          quantity: 1,
          costMissing: false,
        })),
        nextOffset: args.offset + size < total ? args.offset + size : null,
      };
    });
    expect(offsets).toHaveLength(11);
    expect(result.sections[0]?.rows).toHaveLength(total);
    expect(result.sections[0]?.rows.at(-1)?.id).toBe('event-1001');
    expect(result.sections[0]?.summary.totalAmountMinor).toBe(-2500);
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
      {
        ...request,
        fromDate: '2026-10-21',
        toDate: '2026-10-27',
        comparePrevious: true,
        comparisonRange: 'previous',
      },
      principal,
      async (args) => {
        calls.push({ fromDate: args.fromDate, toDate: args.toDate, pageSize: args.pageSize });
        const comparison = args.pageSize === 1;
        return {
          ok: true,
          summary: {
            eventCount: comparison ? 1 : 0,
            orderCount: 0,
            totalAmountMinor: comparison ? -500 : 0,
            totalQuantity: 0,
            incompleteCostEvents: 0,
            coverageNote: null,
          },
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

  it('rejects cross-shop rows returned by a broken RPC before serializing PDF', async () => {
    await expect(
      collectAuthorizedReportExport(request, principal, async () => ({
        ok: true,
        summary: {
          eventCount: 1,
          orderCount: 1,
          totalAmountMinor: 500,
          totalQuantity: 1,
          incompleteCostEvents: 0,
          coverageNote: null,
        },
        rows: [
          {
            id: 'leaked',
            shopId: '44444444-4444-4444-8444-444444444444',
            occurredAt: '2026-10-29T09:00:00.000Z',
            label: 'Secret from other shop',
            amountMinor: 500,
            quantity: 1,
            sourceKind: 'payment',
            costMissing: false,
          },
        ],
        nextOffset: null,
      })),
    ).rejects.toThrow('report_export_scope_mismatch');
  });

  it('fails rather than exporting two pages from inconsistent changing summaries', async () => {
    await expect(
      collectAuthorizedReportExport(request, principal, async (args) => ({
        ok: true,
        summary: {
          eventCount: args.offset === 0 ? 101 : 102,
          orderCount: 1,
          totalAmountMinor: 500,
          totalQuantity: 101,
          incompleteCostEvents: 0,
          coverageNote: null,
        },
        rows: Array.from({ length: args.offset === 0 ? 100 : 1 }, (_, index) => ({
          id: 'event-' + (args.offset + index),
          shopId: shop,
          occurredAt: '2026-10-29T09:00:00.000Z',
          label: 'Payment',
          amountMinor: 500,
          quantity: 1,
          sourceKind: 'payment',
          costMissing: false,
        })),
        nextOffset: args.offset === 0 ? 100 : null,
      })),
    ).rejects.toThrow('report_export_snapshot_changed');
  });

  it('R3 rejects skipped source-record pages even when the reported total matches', async () => {
    const result = collectAuthorizedReportExport(request, principal, async (args) => {
      const rows = Array.from({ length: 50 }, (_, index) => ({
        id: `record-${args.offset + index}`,
        shopId: shop,
        occurredAt: '2026-10-29T09:00:00.000Z',
        label: 'Payment',
        sourceKind: 'payment',
        amountMinor: 100,
        quantity: 1,
        costMissing: false,
      }));
      return {
        ok: true,
        summary: {
          eventCount: 100,
          orderCount: 1,
          totalAmountMinor: 10000,
          totalQuantity: 100,
          incompleteCostEvents: 0,
          coverageNote: null,
        },
        rows,
        nextOffset: args.offset === 0 ? 100 : null,
      };
    });
    await expect(result).rejects.toThrow('report_export_pagination_invalid');
  });

  it('R3 rejects an invalid canonical amount before it reaches PDF generation', async () => {
    await expect(
      collectAuthorizedReportExport(request, principal, async () => ({
        ok: true,
        summary: {
          eventCount: 1,
          orderCount: 1,
          totalAmountMinor: 100,
          totalQuantity: 1,
          incompleteCostEvents: 0,
          coverageNote: null,
        },
        rows: [
          {
            id: 'record-1',
            shopId: shop,
            occurredAt: '2026-10-29T09:00:00.000Z',
            label: 'Payment',
            sourceKind: 'payment',
            amountMinor: Number.NaN,
            quantity: 1,
            costMissing: false,
          },
        ],
        nextOffset: null,
      })),
    ).rejects.toThrow('report_export_source_invalid');
  });

  it('rejects nonfinite canonical summary amounts before generating a PDF', async () => {
    await expect(
      collectAuthorizedReportExport(request, principal, async () => ({
        ok: true,
        summary: {
          eventCount: 1,
          orderCount: 1,
          totalAmountMinor: 100,
          totalQuantity: Number.NaN,
          incompleteCostEvents: 0,
          coverageNote: null,
        },
        rows: [
          {
            id: 'payment-1',
            shopId: shop,
            occurredAt: '2026-10-29T09:00:00.000Z',
            label: 'Payment',
            sourceKind: 'payment',
            amountMinor: 100,
            quantity: 1,
            costMissing: false,
          },
        ],
        nextOffset: null,
      })),
    ).rejects.toThrow('report_export_summary_invalid');
  });

  it('rejects invalid comparison summaries rather than printing a fake previous period', async () => {
    await expect(
      collectAuthorizedReportExport(
        { ...request, comparePrevious: true },
        principal,
        async (args) => ({
          ok: true,
          summary: {
            eventCount: 0,
            orderCount: args.pageSize === 1 ? Number.NaN : 0,
            totalAmountMinor: 0,
            totalQuantity: 0,
            incompleteCostEvents: 0,
            coverageNote: null,
          },
          rows: [],
          nextOffset: null,
        }),
      ),
    ).rejects.toThrow('report_export_summary_invalid');
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
  it('rejects duplicated source records across canonical pagination boundaries', async () => {
    await expect(
      collectAuthorizedReportExport(request, principal, async (args) => {
        const rows = Array.from({ length: args.offset === 0 ? 100 : 1 }, (_, index) => ({
          id: args.offset === 0 ? `record-${index + 1}` : 'record-1',
          shopId: shop,
          occurredAt: '2026-10-29T09:00:00.000Z',
          label: 'Payment',
          sourceKind: 'payment',
          amountMinor: 100,
          quantity: 1,
          costMissing: false,
        }));
        return {
          ok: true,
          summary: {
            eventCount: 101,
            orderCount: 1,
            totalAmountMinor: 10100,
            totalQuantity: 101,
            incompleteCostEvents: 0,
            coverageNote: null,
          },
          rows,
          nextOffset: args.offset === 0 ? 100 : null,
        };
      }),
    ).rejects.toThrow('report_export_duplicate_record');
  });
  it('fails closed when a canonical RPC returns records outside the Cairo report dates', async () => {
    await expect(
      collectAuthorizedReportExport(request, principal, async () => ({
        ok: true,
        summary: {
          eventCount: 1,
          orderCount: 1,
          totalAmountMinor: 100,
          totalQuantity: 1,
          incompleteCostEvents: 0,
          coverageNote: null,
        },
        rows: [
          {
            id: 'outside-period',
            shopId: shop,
            occurredAt: '2026-11-01T10:00:00.000Z',
            label: 'Payment',
            sourceKind: 'payment',
            amountMinor: 100,
            quantity: 1,
            costMissing: false,
          },
        ],
        nextOffset: null,
      })),
    ).rejects.toThrow('report_export_source_invalid');
  });
});
