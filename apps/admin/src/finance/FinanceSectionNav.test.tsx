import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Router } from 'wouter';
import { FinanceSectionNav } from './FinanceSectionNav';

describe('FinanceSectionNav', () => {
  it('marks the active finance section and preserves all four deep links', () => {
    const html = renderToStaticMarkup(
      <Router ssrPath="/finance/expenses">
        <FinanceSectionNav active="expenses" />
      </Router>,
    );
    expect(html).toContain('aria-label="Finance sections"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('/finance/expenses');
    expect(html).toContain('/finance/end-day');
    expect(html).toContain('/finance/settlements');
    expect(html).toContain('Bank &amp; Cash');
  });
});
