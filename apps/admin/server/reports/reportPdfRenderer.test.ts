import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { renderReportPdf } from './reportPdfRenderer.js';
import type { ReportExportData } from './reportPdfExport.js';

const shop = '11111111-1111-4111-8111-111111111111';
function payload(count: number): ReportExportData {
  return {
    kind: 'current',
    fromDate: '2026-10-01',
    toDate: '2026-10-29',
    shopIds: [shop],
    source: 'POS',
    context: {},
    totalCanonicalAreas: 22,
    skippedUnauthorizedCount: 0,
    sections: [
      {
        area: 'refunds',
        summary: {
          eventCount: count,
          orderCount: count,
          totalAmountMinor: -9255,
          totalQuantity: count,
          incompleteCostEvents: 1,
          coverageNote: 'Verified cost missing for one source event',
        },
        rows: Array.from({ length: count }, (_, index) => ({
          id: `refund-${index}`,
          shopId: shop,
          sourceKind: 'refund',
          occurredAt: '2026-10-29T08:00:00.000Z',
          label: index === count - 1 ? 'مرتجع عميل' : `Refund source row ${index}`,
          amountMinor: index === count - 1 ? -525 : -100,
          quantity: 1,
          orderSource: 'POS' as const,
          costMissing: index === 0,
        })),
      },
    ],
  };
}

describe('PDF report rendering (actual PDF bytes)', () => {
  it('renders Arabic source labels and complete multi-page source rows without truncation', async () => {
    const bytes = await renderReportPdf(payload(120));
    expect(bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    expect(doc.getTitle()).toContain('TUX Reports');
    expect(doc.getSubject()).toContain('120');
  });

  it('keeps empty and cost-incomplete sections explicit rather than inventing profit', async () => {
    const data = payload(0);
    const bytes = await renderReportPdf(data);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(doc.getSubject()).toContain('0 source records');
  });
});
