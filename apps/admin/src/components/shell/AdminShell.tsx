import type { AdminSessionPrincipal } from '@tux/admin-contracts';
import type { PropsWithChildren, ReactNode } from 'react';

import { AdminTopBar } from './AdminTopBar';
import { DesktopSidebar } from './DesktopSidebar';
import { MobileTabBar, type AdminPrimaryDestination } from './MobileTabBar';

export function primaryDestinationsFor(
  principal: AdminSessionPrincipal,
): AdminPrimaryDestination[] {
  const result: AdminPrimaryDestination[] = ['home'];
  if (principal.permissions.includes('orders.view')) result.push('orders');
  if (principal.permissions.includes('catalog.view')) result.push('catalog');
  if (principal.permissions.includes('inventory.view')) result.push('inventory');
  result.push('more');
  return result;
}

export function AdminShell({
  principal,
  shopControl,
  onLogout,
  children,
}: PropsWithChildren<{
  principal: AdminSessionPrincipal;
  shopControl?: ReactNode;
  onLogout(): void;
}>) {
  return (
    <div className="admin-shell">
      <DesktopSidebar principal={principal} />
      <div className="admin-shell__workspace">
        <AdminTopBar principal={principal} shopControl={shopControl} onLogout={onLogout} />
        <main className="admin-shell__content">{children}</main>
      </div>
      <MobileTabBar permitted={primaryDestinationsFor(principal)} />
    </div>
  );
}
