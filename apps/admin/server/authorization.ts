import type { AdminPermission, AdminSessionPrincipal } from '@tux/admin-contracts';

export class AdminAuthorizationError extends Error {
  constructor(readonly code: 'permission_forbidden' | 'shop_forbidden') {
    super(code);
    this.name = 'AdminAuthorizationError';
  }
}

export function requirePermission(
  principal: AdminSessionPrincipal,
  permission: AdminPermission,
  shopId?: string,
): void {
  if (!principal.permissions.includes(permission)) {
    throw new AdminAuthorizationError('permission_forbidden');
  }
  if (shopId !== undefined && !principal.shopIds.includes(shopId)) {
    throw new AdminAuthorizationError('shop_forbidden');
  }
}
