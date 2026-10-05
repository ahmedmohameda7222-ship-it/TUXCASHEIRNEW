import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { AdminSessionPrincipal } from '@tux/admin-contracts';
import { AdminShell, primaryDestinationsFor } from './AdminShell';
import { AdminTopBar } from './AdminTopBar';
import { DesktopSidebar } from './DesktopSidebar';
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
      <MobileTabBar
        permitted={['home', 'orders', 'catalog', 'inventory', 'more']}
        currentPath="/orders"
      />,
    );
    for (const label of ['Home', 'Orders', 'Catalog', 'Inventory', 'More']) {
      expect(html).toContain(`>${label}<`);
    }
    expect(html).toContain('href="/orders"');
    expect(html).toContain('aria-current="page"');
  });

  it('keeps tablet rail links named and marks the active section', () => {
    const html = renderToStaticMarkup(<DesktopSidebar principal={owner} currentPath="/customers" />);
    expect(html).toContain('aria-label="Customers"');
    expect(html).toContain('href="/customers"');
    expect(html).toContain('aria-current="page"');
  });

  it('gives the phone logout action an explicit accessible name', () => {
    const html = renderToStaticMarkup(
      <AdminTopBar principal={owner} onLogout={() => undefined} />,
    );
    expect(html).toContain('aria-label="Log out"');
  });

  it('removes a primary destination when the principal lacks its permission', () => {
    const limited: AdminSessionPrincipal = { ...owner, permissions: ['orders.view'] };
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
