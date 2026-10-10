import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Finance successful-empty state guards', () => {
  it('does not report an empty expenses list while the request failed', () => {
    const source = readFileSync('apps/admin/src/finance/ExpensesPage.tsx', 'utf8');
    expect(source).toContain('!operations.expensesQuery.isError &&');
    expect(source).toContain('operations.expensesQuery.data?.expenses.length === 0');
  });

  it('does not report an empty finalized-day history while the request failed', () => {
    const source = readFileSync('apps/admin/src/finance/EndDayHistoryPage.tsx', 'utf8');
    expect(source).toContain('!operations.dayHistoryQuery.isError &&');
    expect(source).toContain('history?.snapshots.length === 0');
  });
});
