import {
  Boxes,
  Home,
  MoreHorizontal,
  PackageSearch,
  ReceiptText,
  type LucideIcon,
} from 'lucide-react';

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

export function MobileTabBar({ permitted }: { permitted: readonly AdminPrimaryDestination[] }) {
  return (
    <nav className="admin-mobile-tabs" aria-label="Primary" data-admin-mobile-nav>
      {permitted.map((destination) => {
        const item = DESTINATIONS[destination];
        const Icon = item.icon;
        return (
          <a className="admin-mobile-tabs__item" href={item.href} key={destination}>
            <Icon aria-hidden="true" size={21} strokeWidth={2} />
            <span>{item.label}</span>
          </a>
        );
      })}
    </nav>
  );
}
