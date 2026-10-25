import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Router } from 'wouter';
import { FinanceSectionNav } from './FinanceSectionNav';

function financeMarkup(active: 'accounts' | 'expenses' | 'reconciliation', canReconcile: boolean) {
  return renderToStaticMarkup(
    <Router ssrPath="/finance/reconciliation">
      <FinanceSectionNav active={active} canReconcile={canReconcile} />
    </Router>,
  );
}

describe('FinanceSectionNav', () => {
  it('exposes exactly Money, Expenses and Reconciliation in the primary navigation', () => {
    const html = financeMarkup('reconciliation', false);
    const primary = html.match(/<nav[^>]*aria-label="Finance sections"[^>]*>(.*?)<\/nav>/s)?.[1];
    expect(primary).toBeDefined();
    expect(primary?.match(/<a /g)).toHaveLength(3);
    expect(primary).toContain('>Money</a>');
    expect(primary).toContain('>Expenses</a>');
    expect(primary).toContain('>Reconciliation</a>');
    expect(primary).toContain('href="/finance/reconciliation"');
    expect(primary).not.toContain('Settlements');
    expect(primary).not.toContain('End Day');
    expect(html).not.toContain('Advanced finance');
  });

  it('keeps existing settlement and Z routes reachable only in the secondary advanced section', () => {
    const html = financeMarkup('accounts', true);
    const primary = html.match(/<nav[^>]*aria-label="Finance sections"[^>]*>(.*?)<\/nav>/s)?.[1];
    expect(primary?.match(/<a /g)).toHaveLength(3);
    expect(html).toContain('Advanced finance');
    expect(html).toContain('href="/finance/settlements"');
    expect(html).toContain('href="/finance/end-day"');
    expect(primary).not.toContain('Settlements');
    expect(primary).not.toContain('End Day');
  });
});
