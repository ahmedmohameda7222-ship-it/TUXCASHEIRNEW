import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReportExportActions } from './ReportExportActions';
import type { ReportFilters } from './useReports';

const filters: ReportFilters = {
  area: 'sales', fromDate: '2026-10-01', toDate: '2026-10-29',
  source: null, shopIds: ['11111111-1111-4111-8111-111111111111'],
  comparePrevious: false, context: {}, offset: 0,
};

describe('R4 Reports PDF export actions', () => {
  it('offers two real export actions for valid selected report scope', () => {
    const html = renderToStaticMarkup(<ReportExportActions filters={filters} shopId={filters.shopIds[0]!} csrfToken={'a'.repeat(64)} />);
    expect(html).toContain('Download report PDF');
    expect(html).toContain('All 22 reports (1 PDF)');
    expect(html).not.toContain('disabled=""');
  });
  it('disables both PDF actions for reversed dates and missing CSRF authority', () => {
    const invalid = renderToStaticMarkup(<ReportExportActions filters={{ ...filters, fromDate: '2026-10-30' }} shopId={filters.shopIds[0]!} csrfToken={'a'.repeat(64)} />);
    expect((invalid.match(/disabled=""/g) ?? []).length).toBe(2);
    const missingSession = renderToStaticMarkup(<ReportExportActions filters={filters} shopId={filters.shopIds[0]!} csrfToken={null} />);
    expect((missingSession.match(/disabled=""/g) ?? []).length).toBe(2);
  });
});
