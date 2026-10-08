import type { AdminPermission, AdminSessionPrincipal } from '@tux/admin-contracts';
import { Link, useLocation } from 'wouter';

import { ApprovalsPage } from '../approvals/ApprovalsPage';
import { AuditPage } from '../audit/AuditPage';
import { CatalogPage } from '../catalog/CatalogPage';
import { PublishReviewPage } from '../catalog/PublishReviewPage';
import { PageScaffold } from '../components/layout/PageScaffold';
import { HomeDashboard } from '../dashboard/HomeDashboard';
import { CustomersPage } from '../customers/CustomersPage';
import { DeliveryPage } from '../delivery/DeliveryPage';
import { InventoryPage } from '../inventory/InventoryPage';
import { FinancePage } from '../finance/FinancePage';
import { ExpensesPage } from '../finance/ExpensesPage';
import { SettlementsPage } from '../finance/SettlementsPage';
import { EndDayPage } from '../finance/EndDayPage';
import { OrdersPage } from '../orders/OrdersPage';
import { PurchasingPage } from '../purchasing/PurchasingPage';
import { ReportsPage } from '../reports/ReportsPage';
import { SettingsPage } from '../settings/SettingsPage';
import { StaffPage } from '../staff/StaffPage';

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
  { path: '/approvals', label: 'Approvals', permission: 'approvals.review' },
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

  if (location === '/catalog/products/publishing') return <PublishReviewPage />;
  if (route.path === '/') return <HomeDashboard />;
  if (route.path === '/catalog/products') return <CatalogPage />;
  if (route.path === '/settings') return <SettingsPage />;
  if (route.path === '/approvals') return <ApprovalsPage />;
  if (route.path === '/audit') return <AuditPage />;
  if (route.path === '/inventory') return <InventoryPage />;
  if (route.path === '/orders') return <OrdersPage />;
  if (route.path === '/customers') return <CustomersPage />;
  if (route.path === '/delivery') return <DeliveryPage />;
  if (route.path === '/purchasing') return <PurchasingPage />;
  if (route.path === '/staff') return <StaffPage />;
  if (route.path === '/finance') {
    if (location.startsWith('/finance/expenses')) return <ExpensesPage />;
    if (location.startsWith('/finance/settlements')) return <SettlementsPage />;
    if (location.startsWith('/finance/end-day')) return <EndDayPage />;
    return <FinancePage />;
  }
  if (route.path === '/reports') return <ReportsPage />;

  if (route.path === '/more') {
    const secondary = ADMIN_ROUTES.filter(
      (candidate) =>
        !new Set(['/', '/orders', '/catalog/products', '/inventory', '/more']).has(
          candidate.path,
        ) && routeIsPermitted(principal, candidate.path),
    );
    return (
      <PageScaffold
        eyebrow="TUX Admin"
        title="More"
        description="Additional management areas available to your role."
      >
        <div className="admin-more-grid">
          {secondary.map((candidate) => (
            <Link className="admin-more-card" href={candidate.path} key={candidate.path}>
              <strong>{candidate.label}</strong>
              <span>Open</span>
            </Link>
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
