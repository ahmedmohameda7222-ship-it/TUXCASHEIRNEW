import type { AdminPermission, AdminSessionPrincipal } from '@tux/admin-contracts';
import { useLocation } from 'wouter';

import { PageScaffold } from '../components/layout/PageScaffold';

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
  { path: '/more', label: 'More' },
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
      <PageScaffold
        eyebrow="Access unavailable"
        title="Not available"
        description="This area is not included in your current Admin access."
        primaryAction={
          <button className="admin-primary-button" type="button" onClick={() => navigate('/')}>
            Go home
          </button>
        }
      />
    );
  }

  if (route.path === '/more') {
    const secondary = ADMIN_ROUTES.filter(
      (candidate) =>
        !new Set(['/', '/orders', '/catalog/products', '/inventory', '/more']).has(candidate.path) &&
        routeIsPermitted(principal, candidate.path),
    );
    return (
      <PageScaffold eyebrow="TUX Admin" title="More" description="Additional management areas available to your role.">
        <div className="admin-more-grid">
          {secondary.map((candidate) => (
            <a className="admin-more-card" href={candidate.path} key={candidate.path}>
              <strong>{candidate.label}</strong>
              <span>Open</span>
            </a>
          ))}
        </div>
      </PageScaffold>
    );
  }

  return (
    <PageScaffold
      eyebrow="TUX Admin"
      title={route.label}
      description="Authenticated management workspace."
    />
  );
}
