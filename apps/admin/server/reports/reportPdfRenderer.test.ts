import { describe, expect, it } from 'vitest';
import { renderAuthorizedReportPdf } from './reportPdfRenderer';
import type { AuthorizedExport } from './reportPdfExport';

function sampleExport(rows = 120): AuthorizedExport {
  return {
    fromDate: '2026-10-01',
    toDate: '2026-10-29',
    selectedShops: ['11111111-1111-4111-8111-111111111111'],
    requestedAreaCount: 22,
    sections: [
      {
        area: 'refunds',
        summary: {
          eventCount: rows,
          orderCount: 2,
          totalAmountMinor: -1000,
          totalQuantity: rows,
          incompleteCostEvents: 2,
          coverageNote: 'Two refund costs not available',
        },
        rows: Array.from({ length: rows }, (_, index) => ({
          id: `refund-${index + 1}`,
          shopId: '11111111-1111-4111-8111-111111111111',
          occurredAt: '2026-10-29T10:00:00.000Z',
          label: index === rows - 1 ? 'LAST AUTHORITATIVE RECORD' : 'Refund',
          sourceKind: 'refund',
          amountMinor: -1000,
          quantity: 1,
          costMissing: index < 2,
        })),
      },
    ],
  };
}

describe('R4 multi-page canonical report PDF', () => {
  it('generates a real PDF with the final source row, negative money and missing-cost notes', () => {
    const buffer = renderAuthorizedReportPdf(sampleExport(120), {
      generatedAt: '2026-10-29T10:00:00.000Z',
      shopNames: { '11111111-1111-4111-8111-111111111111': 'TUX Maadi' },
    });
    const text = buffer.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('LAST AUTHORITATIVE RECORD');
    expect(text).toContain('-10.00');
    expect(text).toContain('Cost data incomplete');
    expect(text).toContain('TUX Maadi');
    expect(text).toContain('Activity over time');
    expect(text).toContain('Africa/Cairo');
    expect(text).toContain('2026-10-29 | ######################### (120)');
    expect(text).toContain('/Type /Pages');
    expect(text).toContain('xref');
    expect(text).toContain('Page 2 /');
  });

  it('has section headings for every authorized area only', () => {
    const report = sampleExport(0);
    report.sections.push({ ...report.sections[0]!, area: 'sales' });
    const text = renderAuthorizedReportPdf(report, {
      generatedAt: '2026-10-29T10:00:00.000Z',
      shopNames: {},
    }).toString('latin1');
    expect(text).toContain('Refunds and returns');
    expect(text).toContain('Sales');
    expect(text).toContain('2 authorized sections of 22');
    expect(text).not.toContain('Finance bank account details');
  });

  it('keeps long source labels within printable A4 text width at 9pt Courier', () => {
    const report = sampleExport(1);
    report.sections[0]!.rows[0]!.label = 'LONG ' + 'X'.repeat(310);
    const pdf = renderAuthorizedReportPdf(report, {
      generatedAt: '2026-10-29T10:00:00.000Z',
      shopNames: {},
    }).toString('latin1');
    // PDF Courier at 9pt: printable A4 width ~= 523pt, max 96 characters.
    const lines = [...pdf.matchAll(/ Td \((.*?)\) Tj ET/g)].map((match) => match[1]!);
    expect(lines.length).toBeGreaterThan(8);
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(94);
    expect(lines.join('')).toContain('X'.repeat(90));
  });

  it('fails closed for non-encodable record text rather than silently corrupting names', () => {
    const report = sampleExport(1);
    report.sections[0]!.rows[0]!.label = 'مبيعات';
    expect(() =>
      renderAuthorizedReportPdf(report, {
        generatedAt: '2026-10-29T10:00:00.000Z',
        shopNames: {},
      }),
    ).toThrow('report_export_font_unsupported');
  });
});
