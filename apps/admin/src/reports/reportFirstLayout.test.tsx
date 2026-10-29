import type { AdminReportArea } from '@tux/admin-contracts';
import { ADMIN_REPORT_AREAS } from '@tux/admin-contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ReportFilters } from './ReportFilters';
import { ReportView } from './ReportView';
import type { ReportFilters as ReportQueryFilters } from './useReports';

const filters: ReportQueryFilters = {
  area: 'sales',
  fromDate: '2026-10-19',
  toDate: '2026-10-25',
  source: null,
  shopIds: ['11111111-1111-4111-8111-111111111111'],
  comparePrevious: false,
  context: {},
  offset: 0,
};

function renderPicker(area: AdminReportArea = 'sales') {
  return renderToStaticMarkup(
    <ReportFilters
      value={{ ...filters, area }}
      onChange={() => undefined}
      onExpand={() => undefined}
      canCompareShops={false}
      allShopIds={filters.shopIds}
      options={{}}
    />,
  );
}

describe('R1 selected report evidence presentation', () => {
  it('titles the selected report above its canonical summary and source events', () => {
    const html = renderToStaticMarkup(
      <ReportView
        data={{
          ok: true,
          area: 'sales',
          summary: {
            eventCount: 1,
            orderCount: 1,
            totalAmountMinor: 12345,
            totalQuantity: 2,
            incompleteCostEvents: 0,
            coverageNote: null,
          },
          rows: [],
          nextOffset: null,
        }}
        filters={filters}
        onOffset={() => undefined}
        loading={false}
        error={false}
        retry={() => undefined}
      />,
    );
    expect(html).toContain('Sales');
    expect(html).toContain('Source activity');
    expect(html).toContain('tux-report-source-card');
    expect(html).toContain('Recorded amount');
    expect(html).not.toContain('Employee sales leaderboard');
  });
});

describe('R1 approved Report-First layout', () => {
  it('starts with Choose a report and all 22 canonical reports, without question-first tiles', () => {
    const markup = renderPicker();
    expect(markup).toContain('Choose a report');
    expect(markup).toContain('Quick reports');
    expect(markup).toContain('All reports');
    for (const area of ADMIN_REPORT_AREAS) {
      expect(markup).toContain(`value="${area}"`);
    }
    expect(markup).not.toContain('What would you like to know');
  });

  it('places source filtering inside the compact Filter disclosure and provides responsive date and shop anchors', () => {
    const markup = renderPicker();
    expect(markup).toContain('tux-report-date-start');
    expect(markup).toContain('tux-report-date-end');
    expect(markup).toContain('tux-report-shop');
    expect(markup.indexOf('Order source')).toBeGreaterThan(markup.indexOf('<details'));
  });

  it('offers every authorized shop instead of limiting Owner to only the first shop', () => {
    const markup = renderToStaticMarkup(
      <ReportFilters
        value={{ ...filters, shopIds: ['shop-one'] }}
        onChange={() => undefined}
        onExpand={() => undefined}
        canCompareShops
        allShopIds={['shop-one', 'shop-two']}
        shopNames={{ 'shop-one': 'Maadi', 'shop-two': 'Zamalek' }}
        options={{}}
      />,
    );
    expect(markup).toContain('value="shop-two"');
    expect(markup).toContain('Zamalek');
  });

  it('offers fast Cairo date presets and an explicit reset without losing report selection', () => {
    const markup = renderPicker('refunds');
    expect(markup).toContain('Today');
    expect(markup).toContain('7 days');
    expect(markup).toContain('30 days');
    expect(markup).toContain('Reset');
    expect(markup).toContain('value="refunds" selected');
  });
});
