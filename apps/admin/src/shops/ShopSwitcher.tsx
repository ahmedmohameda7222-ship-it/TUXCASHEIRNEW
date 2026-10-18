import { useQueries } from '@tanstack/react-query';
import type { AdminSettingsWorkspace, ShopScope } from '@tux/admin-contracts';

import { adminFetch } from '../lib/adminApi';
import { useShopScope } from './ShopScopeProvider';

function scopeValue(scope: ShopScope): string {
  return scope.kind === 'all-shops' ? '__all__' : scope.shopId;
}

function shopOptionLabel(
  shop: AdminSettingsWorkspace['shop'] | undefined,
  shopId: string,
  loading: boolean,
): string {
  if (shop?.name) {
    if (!shop.active) return `${shop.name} · Inactive`;
    if (shop.temporaryClosed) return `${shop.name} · Temporarily closed`;
    return shop.name;
  }
  if (loading) return 'Loading shop name…';
  return `Shop · ${shopId.slice(0, 8)}`;
}

export function ShopSwitcher() {
  const { principal, scope, setScope } = useShopScope();

  // The settings workspace is an existing authorized shop-scoped read. Never
  // fetch names for shops outside principal.shopIds or for roles without access.
  const canReadNames = principal.permissions.includes('settings.manage');
  const shopMetadata = useQueries({
    queries: principal.shopIds.map((shopId) => ({
      queryKey: ['admin', 'shop-switcher', principal.businessId, principal.employeeId, shopId],
      enabled: canReadNames,
      staleTime: 15 * 60_000,
      queryFn: async (): Promise<AdminSettingsWorkspace['shop']> => {
        const workspace = await adminFetch<Pick<AdminSettingsWorkspace, 'shop'>>(
          `/api/admin/settings?shopId=${encodeURIComponent(shopId)}&view=workspace`,
        );
        if (workspace.shop.id !== shopId) throw new Error('settings_shop_mismatch');
        return workspace.shop;
      },
    })),
  });
  if (principal.shopIds.length <= 1 && principal.role !== 'OWNER') return null;

  return (
    <label className="shop-switcher">
      <span>Shop</span>
      <select
        value={scopeValue(scope)}
        onChange={(event) => {
          setScope(
            event.target.value === '__all__'
              ? { kind: 'all-shops' }
              : { kind: 'shop', shopId: event.target.value },
          );
        }}
      >
        {principal.role === 'OWNER' ? <option value="__all__">All Shops</option> : null}
        {principal.shopIds.map((shopId, index) => {
          const shop = shopMetadata[index]?.data;
          const label = shopOptionLabel(
            shop,
            shopId,
            canReadNames && Boolean(shopMetadata[index]?.isPending),
          );
          return (
            <option key={shopId} value={shopId}>
              {label}
            </option>
          );
        })}
      </select>
    </label>
  );
}
