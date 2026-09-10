import { describe, expect, it } from 'vitest';

import type { AdminSessionPrincipal, ShopScope } from '@tux/admin-contracts';
import { initialShopScope, requireConcreteShop, validateShopScope } from './ShopScopeProvider';

const manager: AdminSessionPrincipal = {
  employeeId: 'employee-1',
  businessId: 'business-1',
  role: 'MANAGER',
  permissions: ['orders.view'],
  shopIds: ['shop-a', 'shop-b'],
};

describe('Admin shop scope', () => {
  it('opens a one-shop user directly in that shop', () => {
    expect(initialShopScope({ ...manager, shopIds: ['shop-a'] })).toEqual({
      kind: 'shop',
      shopId: 'shop-a',
    });
  });

  it('never permits a non-OWNER All Shops scope', () => {
    expect(() => validateShopScope(manager, { kind: 'all-shops' })).toThrow(/all_shops_forbidden/);
  });

  it('allows OWNER aggregate scope but requires a concrete shop for mutation', () => {
    const owner: AdminSessionPrincipal = {
      ...manager,
      role: 'OWNER',
      shopIds: ['shop-a', 'shop-b'],
    };
    const scope: ShopScope = { kind: 'all-shops' };
    expect(validateShopScope(owner, scope)).toEqual(scope);
    expect(() => requireConcreteShop(scope)).toThrow(/concrete_shop_required/);
  });

  it('rejects a selected shop outside the resolved principal scope', () => {
    expect(() => validateShopScope(manager, { kind: 'shop', shopId: 'shop-z' })).toThrow(
      /shop_forbidden/,
    );
  });
});
