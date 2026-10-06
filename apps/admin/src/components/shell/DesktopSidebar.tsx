import {
  Bell,
  Boxes,
  Building2,
  ClipboardList,
  ContactRound,
  FileBarChart2,
  Home,
  Landmark,
  MessageCircleMore,
  PackageSearch,
  ReceiptText,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Truck,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import { Link, useLocation } from 'wouter';

import type { AdminSessionPrincipal } from '@tux/admin-contracts';
import { ADMIN_ROUTES, routeIsPermitted } from '../../app/routes';

const ICONS: Record<string, LucideIcon> = {
  '/': Home,
  '/orders': ReceiptText,
  '/catalog/products': Boxes,
  '/inventory': PackageSearch,
  '/customers': ContactRound,
  '/purchasing': ShoppingCart,
  '/staff': UsersRound,
  '/delivery': Truck,
  '/finance': Landmark,
  '/reports': FileBarChart2,
  '/alerts': Bell,
  '/devices': Building2,
  '/whatsapp': MessageCircleMore,
  '/settings': Settings,
  '/audit': ShieldCheck,
};

function routeIsActive(currentPath: string, href: string): boolean {
  return href === '/'
    ? currentPath === '/'
    : currentPath === href || currentPath.startsWith(`${href}/`);
}

type DesktopSidebarProps = {
  principal: AdminSessionPrincipal;
  currentPath?: string;
};

function DesktopSidebarView({ principal, currentPath }: Required<DesktopSidebarProps>) {
  const routes = ADMIN_ROUTES.filter(
    (route) => route.path !== '/more' && routeIsPermitted(principal, route.path),
  );
  return (
    <aside className="admin-sidebar" data-admin-desktop-nav>
      <div className="admin-sidebar__identity" aria-label="TUX Admin">
        <span className="admin-sidebar__mark">T</span>
        <span className="admin-sidebar__brand">TUX Admin</span>
      </div>
      <nav className="admin-sidebar__nav" aria-label="Admin sections">
        {routes.map((route) => {
          const Icon = ICONS[route.path] ?? ClipboardList;
          const active = routeIsActive(currentPath, route.path);
          return (
            <Link
              className={active ? 'admin-sidebar__link is-active' : 'admin-sidebar__link'}
              href={route.path}
              aria-label={route.label}
              aria-current={active ? 'page' : undefined}
              key={route.path}
            >
              <Icon size={19} aria-hidden="true" />
              <span aria-hidden="true">{route.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

function RoutedDesktopSidebar({ principal }: Pick<DesktopSidebarProps, 'principal'>) {
  const [currentPath] = useLocation();
  return <DesktopSidebarView principal={principal} currentPath={currentPath} />;
}

export function DesktopSidebar({ principal, currentPath }: DesktopSidebarProps) {
  return currentPath === undefined ? (
    <RoutedDesktopSidebar principal={principal} />
  ) : (
    <DesktopSidebarView principal={principal} currentPath={currentPath} />
  );
}
