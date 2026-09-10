import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { AdminSessionPrincipal } from '@tux/admin-contracts';
import { AdminShell, primaryDestinationsFor } from './AdminShell';
import { MobileTabBar } from './MobileTabBar';

const owner: AdminSessionPrincipal = {
  employeeId: 'employee-1',
  businessId: 'business-1',
  role: 'OWNER',
  permissions: [
    'orders.view',
    'catalog.view',
    'inventory.view',
    'customers.view',
    'finance.view',
  ],
  shopIds: ['shop-a'],
};

describe('adaptive Admin shell', () => {
  it('renders the five approved phone destinations when permitted', () => {
    const html = renderToStaticMarkup(
      <MobileTabBar permitted={['home', 'orders', 'catalog', 'inventory', 'more']} />,
    );
    for (const label of ['Home', 'Orders', 'Catalog', 'Inventory', 'More']) {
      expect(html).toContain(`>${label}<`);
    }
  });

  it('removes a primary destination when the principal lacks its permission', () => {
    const limited = { ...owner, permissions: ['orders.view'] as const };
    expect(primaryDestinationsFor(limited)).toEqual(['home', 'orders', 'more']);
  });

  it('renders explicit mobile and desktop navigation surfaces around content', () => {
    const html = renderToStaticMarkup(
      <AdminShell principal={owner} onLogout={() => undefined}>
        <p>Workspace content</p>
      </AdminShell>,
    );
    expect(html).toContain('data-admin-mobile-nav');
    expect(html).toContain('data-admin-desktop-nav');
    expect(html).toContain('Workspace content');
  });
});
