import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AdminMetricStrip } from './AdminMetricStrip';

describe('AdminMetricStrip', () => {
  it('preserves honest unavailable values instead of inventing zeroes or percentages', () => {
    const html = renderToStaticMarkup(
      <AdminMetricStrip
        label="Orders key metrics"
        metrics={[
          { id: 'orders', label: 'Total orders', value: null },
          { id: 'active', label: 'Active orders', value: 0 },
        ]}
      />,
    );
    expect(html).toContain('aria-label="Orders key metrics"');
    expect(html).toContain('Total orders');
    expect(html).toContain('Unavailable');
    expect(html).toContain('Active orders');
    expect(html).toContain('>0</dd>');
    expect(html).not.toContain('growth');
  });

  it('renders shop-scoped inventory counts as four read-only definition pairs', () => {
    const html = renderToStaticMarkup(
      <AdminMetricStrip
        label="Inventory summary"
        className="admin-inventory-summary"
        metrics={[
          { id: 'all', label: 'Total items', value: 12 },
          { id: 'unset', label: 'Thresholds not set', value: 2 },
          { id: 'low', label: 'Low stock', value: 3, tone: 'warning' },
          { id: 'out', label: 'Out of stock', value: 0, tone: 'critical' },
        ]}
      />,
    );
    expect(html.match(/<dt>/g) ?? []).toHaveLength(4);
    expect(html.match(/<dd>/g) ?? []).toHaveLength(4);
    expect(html).toContain('admin-inventory-summary');
    expect(html).toContain('admin-metric-strip--warning');
    expect(html).toContain('admin-metric-strip--critical');
    expect(html).not.toContain('<button');
  });
});
