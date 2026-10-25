import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FinanceReconciliationFacts } from './FinanceReconciliationPage';

describe('read-only Finance reconciliation', () => {
  it('does not substitute zero or guessed physical count for an open day', () => {
    const html = renderToStaticMarkup(
      <FinanceReconciliationFacts
        facts={{ businessDayStatus: 'OPEN', paymentBreakdown: { Cash: 10000 }, cashierReconciliations: [] }}
      />,
    );
    expect(html).toContain('Awaiting Operations count');
    expect(html).toContain('Not available');
    expect(html).not.toContain('Actual: 0.00');
    expect(html).not.toContain('Close Business Day');
    expect(html).not.toContain('<button');
  });

  it('displays existing posted cashier variances without mislabeling payment totals as actuals', () => {
    const html = renderToStaticMarkup(
      <FinanceReconciliationFacts
        facts={{
          businessDayStatus: 'CLOSED',
          paymentBreakdown: { Cash: 10000, Card: 5000 },
          cashierReconciliations: [
            {
              cashierWorkerId: 'cashier-1',
              expectedMinor: 10000,
              actualMinor: 9800,
              varianceMinor: -200,
              reason: 'Short count',
              postedAt: '2026-10-25T19:00:00.000Z',
            },
          ],
        }}
      />,
    );
    expect(html).toContain('Finance-posted cashier reconciliation');
    expect(html).toContain('-2.00 EGP');
    expect(html).toContain('Short count');
    expect(html).toContain('Card');
    expect(html).toContain('Not available');
    expect(html).not.toContain('Record count');
  });
});
