export const ADMIN_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'STAFF'] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

export function isAdminRole(value: string): value is AdminRole {
  return (ADMIN_ROLES as readonly string[]).includes(value);
}

export const ADMIN_PERMISSIONS = [
  'orders.view',
  'orders.manage',
  'orders.cancel',
  'orders.refund',
  'catalog.view',
  'catalog.edit',
  'catalog.pricing',
  'catalog.publish',
  'inventory.view',
  'inventory.adjust',
  'inventory.stocktake',
  'inventory.transfer',
  'inventory.override_negative',
  'purchasing.view',
  'purchasing.manage',
  'purchasing.receive',
  'customers.view',
  'customers.manage',
  'customers.merge',
  'loyalty.manage',
  'promotions.manage',
  'staff.view',
  'staff.manage',
  'staff.payments',
  'delivery.view',
  'delivery.manage',
  'finance.view',
  'finance.adjust',
  'finance.reconcile',
  'finance.manage_accounts',
  'reports.view',
  'alerts.view',
  'shops.manage',
  'devices.view',
  'devices.manage',
  'settings.manage',
  'whatsapp.view',
  'whatsapp.manage',
  'audit.view',
  'approvals.review',
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export function isAdminPermission(value: string): value is AdminPermission {
  return (ADMIN_PERMISSIONS as readonly string[]).includes(value);
}

export type AdminSessionPrincipal = {
  employeeId: string;
  businessId: string;
  role: AdminRole;
  permissions: AdminPermission[];
  shopIds: string[];
};

export type ShopScope = { kind: 'shop'; shopId: string } | { kind: 'all-shops' };

export type AdminLoginRequest = { pin: string };

export type AdminSessionResponse = {
  principal: AdminSessionPrincipal;
  csrfToken: string;
};
