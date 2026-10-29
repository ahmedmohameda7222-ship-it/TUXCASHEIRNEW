import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReportFilters as ReportFiltersView } from './ReportFilters';
import { ADMIN_REPORT_AREAS } from '@tux/admin-contracts';
import { describe, expect, it } from 'vitest';
import { REPORT_LABELS, REPORT_TOPICS } from './ReportFilters';
import { chooseReportArea, compatibleReportContext } from './reportAreaTransition';
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

describe('approved report-first picker', () => {
  it('renders quick report choices before the 22-area report select', () => {
    const html = renderToStaticMarkup(
      createElement(ReportFiltersView, {
        value: {
          area: 'sales',
          fromDate: '2026-10-22',
          toDate: '2026-10-29',
          source: null,
          shopIds: ['11111111-1111-4111-8111-111111111111'],
          comparePrevious: false,
          offset: 0,
        },
        onChange: () => {},
        canCompareShops: false,
        allShopIds: ['11111111-1111-4111-8111-111111111111'],
        options: {},
        onExpand: () => {},
      }),
    );
    expect(html).toContain('Choose a report');
    expect(html).toContain('Quick reports');
    expect(html).toContain('All reports');
    expect(html).toContain('Last 7 days');
    expect(html.indexOf('Choose a report')).toBeLessThan(html.indexOf('Report area'));
    const from = html.indexOf('id="tux-report-area"');
    const reportSelect = html.slice(from, html.indexOf('</select>', from));
    expect(reportSelect.match(/<option value="/g)).toHaveLength(22);
  });
});

describe('R2 saved-view area context compatibility', () => {
  it('does not bring unrelated supplier, finance or employee filters into Sales', () => {
    expect(
      compatibleReportContext('sales', {
        supplierId: 'secret-supplier',
        employeeId: 'private-employee',
        paymentMethodId: 'permitted-method',
        status: 'DONE',
      }),
    ).toEqual({ paymentMethodId: 'permitted-method', status: 'DONE' });
  });
  it('does not bring Sales source filters into an Inventory report', () => {
    expect(
      compatibleReportContext('waste', {
        customerId: 'private-customer',
        workerId: 'private-staff',
        productId: 'product',
      }),
    ).toEqual({});
  });
});
