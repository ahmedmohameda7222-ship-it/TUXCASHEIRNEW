import {
  Boxes,
  Home,
  MoreHorizontal,
  PackageSearch,
  ReceiptText,
  type LucideIcon,
} from 'lucide-react';
import { Link, useLocation } from 'wouter';

export type AdminPrimaryDestination = 'home' | 'orders' | 'catalog' | 'inventory' | 'more';

const DESTINATIONS: Record<
  AdminPrimaryDestination,
  { label: string; href: string; icon: LucideIcon }
> = {
  home: { label: 'Home', href: '/', icon: Home },
  orders: { label: 'Orders', href: '/orders', icon: ReceiptText },
  catalog: { label: 'Catalog', href: '/catalog/products', icon: Boxes },
  inventory: { label: 'Inventory', href: '/inventory', icon: PackageSearch },
  more: { label: 'More', href: '/more', icon: MoreHorizontal },
};

function routeIsActive(currentPath: string, href: string): boolean {
  return href === '/'
    ? currentPath === '/'
    : currentPath === href || currentPath.startsWith(`${href}/`);
}

type MobileTabBarProps = {
  permitted: readonly AdminPrimaryDestination[];
  currentPath?: string;
};

function MobileTabBarView({ permitted, currentPath }: Required<MobileTabBarProps>) {
  return (
    <nav className="admin-mobile-tabs" aria-label="Primary" data-admin-mobile-nav>
      {permitted.map((destination) => {
        const item = DESTINATIONS[destination];
        const Icon = item.icon;
        const active = routeIsActive(currentPath, item.href);
        return (
          <Link
            className={active ? 'admin-mobile-tabs__item is-active' : 'admin-mobile-tabs__item'}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            key={destination}
          >
            <Icon aria-hidden="true" size={21} strokeWidth={2} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function RoutedMobileTabBar({ permitted }: Pick<MobileTabBarProps, 'permitted'>) {
  const [currentPath] = useLocation();
  return <MobileTabBarView permitted={permitted} currentPath={currentPath} />;
}

export function MobileTabBar({ permitted, currentPath }: MobileTabBarProps) {
  return currentPath === undefined ? (
    <RoutedMobileTabBar permitted={permitted} />
  ) : (
    <MobileTabBarView permitted={permitted} currentPath={currentPath} />
  );
}
