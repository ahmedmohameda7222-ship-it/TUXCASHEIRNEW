import { execFileSync } from 'node:child_process';
import type { AdminCustomerSummary } from '@tux/admin-contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { CustomerDirectory } from './CustomerDirectory';

const customer: AdminCustomerSummary = {
  id: '40000000-0000-4000-8000-000000000001',
  normalizedPhone: '+201012345678',
  displayName: 'Mona Saleh',
  orderCount: 12,
  lifetimeSpendMinor: 9007199254740990,
  lastOrderAt: '2026-10-12T12:00:00.000Z',
  loyaltyBalance: 120,
  segments: ['VIP', 'Returning'],
};

function render(customers: readonly AdminCustomerSummary[] = [customer]) {
  return renderToStaticMarkup(
    <CustomerDirectory
      customers={customers}
      selectedId={customer.id}
      query=""
      onQueryChange={vi.fn()}
      onSelect={vi.fn()}
      loading={false}
      fetching={false}
      error={false}
      onRetry={vi.fn()}
    />,
  );
}

describe('CRM1 authoritative customer directory', () => {
  it('displays scoped customer facts with exact minor-unit money and no fake avatars', () => {
    const html = render();
    expect(html).toContain('Mona Saleh');
    expect(html).toContain('+201012345678');
    expect(html).toContain('EGP 90,071,992,547,409.90');
    expect(html).toContain('120 pts');
    expect(html).toContain('VIP');
    expect(html).toContain('12 Oct 2026');
    expect(html).toContain('admin-customer-row is-selected');
    expect(html).toContain('MS');
    expect(html).not.toContain('<img');
  });

  it('limits filters, sorting, and counts explicitly to server-loaded records', () => {
    const html = render();
    expect(html).toContain('Filters and sorting apply to loaded customers only.');
    expect(html).toContain('1 loaded customers');
    expect(html).toContain('All segments (loaded results)');
    expect(html).toContain('All loyalty (loaded results)');
    expect(html).toContain('Sort loaded customers');
    expect(html).toContain('disabled=""');
  });

  it('does not fabricate a global total or rows for empty server results', () => {
    const html = render([]);
    expect(html).toContain('No matching customers');
    expect(html).toContain('0 loaded customers');
    expect(html).not.toContain('Mona Saleh');
  });
  it('temporary exact Prettier diagnostics', () => {
    for (const [name, path] of [
      ['TSX', 'apps/admin/src/customers/CustomerDirectory.tsx'],
      ['CSS', 'apps/admin/src/customers/customers.css'],
    ]) {
      const output = execFileSync('npx', ['prettier', path], { encoding: 'utf8' });
      console.log('CRM_FORMAT_CAPTURE_' + name + ':' + JSON.stringify(output));
    }
  });
});
