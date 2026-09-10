import { describe, expect, it } from 'vitest';

import type { AdminSessionPrincipal } from '@tux/admin-contracts';
import { requirePermission } from './authorization';

const principal: AdminSessionPrincipal = {
  employeeId: 'employee-1',
  businessId: 'business-1',
  role: 'MANAGER',
  permissions: ['orders.view', 'inventory.adjust'],
  shopIds: ['shop-a'],
};

describe('Admin authorization', () => {
  it('allows an assigned-shop permission', () => {
    expect(() => requirePermission(principal, 'inventory.adjust', 'shop-a')).not.toThrow();
  });

  it('denies missing permissions', () => {
    expect(() => requirePermission(principal, 'finance.adjust', 'shop-a')).toThrow(
      /permission_forbidden/,
    );
  });

  it('denies a shop outside the principal scope', () => {
    expect(() => requirePermission(principal, 'orders.view', 'shop-b')).toThrow(/shop_forbidden/);
  });

  it('allows OWNER all mapped shops only through resolved principal scope', () => {
    const owner: AdminSessionPrincipal = {
      ...principal,
      role: 'OWNER',
      permissions: ['orders.view'],
      shopIds: ['shop-a', 'shop-b'],
    };
    expect(() => requirePermission(owner, 'orders.view', 'shop-b')).not.toThrow();
    expect(() => requirePermission(owner, 'orders.view', 'shop-c')).toThrow(/shop_forbidden/);
  });
});
