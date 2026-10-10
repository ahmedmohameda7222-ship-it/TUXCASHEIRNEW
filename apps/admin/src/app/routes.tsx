import { lazy } from 'react';
import type { AdminPermission, AdminSessionPrincipal } from '@tux/admin-contracts';
import { Link, useLocation } from 'wouter';

const ApprovalsPage = lazy(() =>
  import('../approvals/ApprovalsPage').then((module) => ({ default: module.ApprovalsPage })),
);
const AuditPage = lazy(() =>
  import('../audit/AuditPage').then((module) => ({ default: module.AuditPage })),
);
const CatalogPage = lazy(() =>
  import('../catalog/CatalogPage').then((module) => ({ default: module.CatalogPage })),
);
const PublishReviewPage = lazy(() =>
  import('../catalog/PublishReviewPage').then((module) => ({ default: module.PublishReviewPage })),
);
import { PageScaffold } from '../components/layout/PageScaffold';
const HomeDashboard = lazy(() =>
  import('../dashboard/HomeDashboard').then((module) => ({ default: module.HomeDashboard })),
);
const CustomersPage = lazy(() =>
  import('../customers/CustomersPage').then((module) => ({ default: module.CustomersPage })),
);
const DeliveryPage = lazy(() =>
  import('../delivery/DeliveryPage').then((module) => ({ default: module.DeliveryPage })),
);
const InventoryPage = lazy(() =>
  import('../inventory/InventoryPage').then((module) => ({ default: module.InventoryPage })),
);
const FinancePage = lazy(() =>
  import('../finance/FinancePage').then((module) => ({ default: module.FinancePage })),
);
const ExpensesPage = lazy(() =>
  import('../finance/ExpensesPage').then((module) => ({ default: module.ExpensesPage })),
);
const SettlementsPage = lazy(() =>
  import('../finance/SettlementsPage').then((module) => ({ default: module.SettlementsPage })),
);
const EndDayPage = lazy(() =>
  import('../finance/EndDayPage').then((module) => ({ default: module.EndDayPage })),
);
const OrdersPage = lazy(() =>
  import('../orders/OrdersPage').then((module) => ({ default: module.OrdersPage })),
);
const PurchasingPage = lazy(() =>
  import('../purchasing/PurchasingPage').then((module) => ({ default: module.PurchasingPage })),
);
const ReportsPage = lazy(() =>
  import('../reports/ReportsPage').then((module) => ({ default: module.ReportsPage })),
);
const SettingsPage = lazy(() =>
  import('../settings/SettingsPage').then((module) => ({ default: module.SettingsPage })),
);
const StaffPage = lazy(() =>
  import('../staff/StaffPage').then((module) => ({ default: module.StaffPage })),
);

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
