import type { ShopScope } from '@tux/admin-contracts';

import { useShopScope } from './ShopScopeProvider';

function scopeValue(scope: ShopScope): string {
  return scope.kind === 'all-shops' ? '__all__' : scope.shopId;
}

export function ShopSwitcher() {
  const { principal, scope, setScope } = useShopScope();
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
        {principal.shopIds.map((shopId, index) => (
          <option key={shopId} value={shopId}>
            Shop {index + 1}
          </option>
        ))}
      </select>
    </label>
  );
}
