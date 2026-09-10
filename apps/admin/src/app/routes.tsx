import type { AdminPermission, AdminSessionPrincipal } from '@tux/admin-contracts';
import { useLocation } from 'wouter';

export type AdminRouteDefinition = {
  path: string;
  label: string;
  permission?: AdminPermission;
};

export const ADMIN_ROUTES: readonly AdminRouteDefinition[] = [
  { path: '/', label: 'Home' },
  { path: '/orders', label: 'Orders', permission: 'orders.view' },
  { path: '/catalog/products', label: 'Catalog', permission: 'catalog.view' },
  { path: '/inventory', label: 'Inventory', permission: 'inventory.view' },
  { path: '/customers', label: 'Customers', permission: 'customers.view' },
  { path: '/purchasing', label: 'Purchasing', permission: 'purchasing.view' },
  { path: '/staff', label: 'Staff', permission: 'staff.view' },
  { path: '/delivery', label: 'Delivery', permission: 'delivery.view' },
  { path: '/finance', label: 'Finance', permission: 'finance.view' },
  { path: '/reports', label: 'Reports', permission: 'reports.view' },
  { path: '/alerts', label: 'Alerts', permission: 'alerts.view' },
  { path: '/devices', label: 'Devices / Operations', permission: 'devices.view' },
  { path: '/whatsapp', label: 'WhatsApp', permission: 'whatsapp.view' },
  { path: '/settings', label: 'Settings', permission: 'settings.manage' },
  { path: '/audit', label: 'Audit Log', permission: 'audit.view' },
] as const;

function routeForLocation(location: string): AdminRouteDefinition | undefined {
  return [...ADMIN_ROUTES]
    .sort((left, right) => right.path.length - left.path.length)
    .find((route) =>
      route.path === '/'
        ? location === '/'
        : location === route.path || location.startsWith(`${route.path}/`),
    );
}

export function routeIsPermitted(principal: AdminSessionPrincipal, location: string): boolean {
  const route = routeForLocation(location);
  if (!route) return false;
  return route.permission === undefined || principal.permissions.includes(route.permission);
}

export function AdminRoutes({ principal }: { principal: AdminSessionPrincipal }) {
  const [location, navigate] = useLocation();
  const route = routeForLocation(location);
  if (!route || !routeIsPermitted(principal, location)) {
    return (
      <main className="admin-entry">
        <section className="admin-entry__card">
          <p className="admin-entry__eyebrow">Access unavailable</p>
          <h1>Not available</h1>
          <p className="admin-entry__copy">This area is not included in your current Admin access.</p>
          <button className="admin-login__submit" type="button" onClick={() => navigate('/')}>
            Go home
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="admin-entry" aria-labelledby="admin-route-title">
      <section className="admin-entry__card">
        <p className="admin-entry__eyebrow">TUX Admin</p>
        <h1 id="admin-route-title">{route.label}</h1>
        <p className="admin-entry__copy">Authenticated management workspace.</p>
      </section>
    </main>
  );
}
