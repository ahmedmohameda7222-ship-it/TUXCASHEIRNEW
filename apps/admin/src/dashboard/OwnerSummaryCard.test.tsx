import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { OwnerSummaryCard } from './OwnerSummaryCard';

const mock = vi.hoisted(() => ({
  query: {
    isLoading: false,
    isError: false,
    data: undefined as
      | undefined
      | {
          summaries: Array<{
            id: string;
            business_day_id: string;
            generated_at: string;
            summary: Record<string, unknown>;
          }>;
        },
    refetch: vi.fn(),
  },
}));

vi.mock('../finance/useFinanceOperations', () => ({
  useOwnerSummary: () => mock.query,
}));

describe('Owner Summary states', () => {
  it('shows loading rather than a false empty state', () => {
    mock.query.isLoading = true;
    mock.query.isError = false;
    mock.query.data = undefined;
    const html = renderToStaticMarkup(<OwnerSummaryCard shopId="shop" />);
    expect(html).toContain('Loading Owner Summary');
    expect(html).not.toContain('No finalized financial day');
  });

  it('shows a user-safe retry when backend is unavailable', () => {
    mock.query.isLoading = false;
    mock.query.isError = true;
    mock.query.data = undefined;
    const html = renderToStaticMarkup(<OwnerSummaryCard shopId="shop" />);
    expect(html).toContain('Owner Summary unavailable');
    expect(html).toContain('Retry');
    expect(html).not.toContain('No finalized financial day');
  });

  it('shows empty state only when an empty response succeeds', () => {
    mock.query.isLoading = false;
    mock.query.isError = false;
    mock.query.data = { summaries: [] };
    const html = renderToStaticMarkup(<OwnerSummaryCard shopId="shop" />);
    expect(html).toContain('No finalized financial day');
  });

  it('shows authorized populated summary', () => {
    mock.query.isLoading = false;
    mock.query.isError = false;
    mock.query.data = {
      summaries: [
        {
          id: 'summary',
          business_day_id: 'day',
          generated_at: '2026-10-08T18:00:00Z',
          summary: { netSalesMinor: 37000, orderCount: 3 },
        },
      ],
    };
    const html = renderToStaticMarkup(<OwnerSummaryCard shopId="shop" />);
    expect(html).toContain('Net sales');
    expect(html).toContain('Orders');
    expect(html).not.toContain('No finalized financial day');
  });
});
