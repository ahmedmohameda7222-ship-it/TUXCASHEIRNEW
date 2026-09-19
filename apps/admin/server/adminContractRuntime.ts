import type {
  AdminApprovalStatus,
  AdminPermission,
  AdminRole,
} from '@tux/admin-contracts';

const ADMIN_ROLE_MEMBERSHIP = {
  OWNER: true,
  ADMIN: true,
  MANAGER: true,
  STAFF: true,
} as const satisfies Record<AdminRole, true>;

export const ADMIN_ROLES = Object.keys(ADMIN_ROLE_MEMBERSHIP) as AdminRole[];

export function isAdminRole(value: string): value is AdminRole {
  return Object.prototype.hasOwnProperty.call(ADMIN_ROLE_MEMBERSHIP, value);
}

const ADMIN_PERMISSION_MEMBERSHIP = {
  'orders.view': true,
  'orders.manage': true,
  'orders.cancel': true,
  'orders.refund': true,
  'catalog.view': true,
  'catalog.edit': true,
  'catalog.pricing': true,
  'catalog.publish': true,
  'inventory.view': true,
  'inventory.adjust': true,
  'inventory.stocktake': true,
  'inventory.transfer': true,
  'inventory.override_negative': true,
  'purchasing.view': true,
  'purchasing.manage': true,
  'purchasing.receive': true,
  'customers.view': true,
  'customers.manage': true,
  'customers.merge': true,
  'loyalty.manage': true,
  'promotions.manage': true,
  'staff.view': true,
  'staff.manage': true,
  'staff.payments': true,
  'delivery.view': true,
  'delivery.manage': true,
  'finance.view': true,
  'finance.adjust': true,
  'finance.reconcile': true,
  'finance.manage_accounts': true,
  'reports.view': true,
  'alerts.view': true,
  'shops.manage': true,
  'devices.view': true,
  'devices.manage': true,
  'settings.manage': true,
  'whatsapp.view': true,
  'whatsapp.manage': true,
  'audit.view': true,
  'approvals.review': true,
} as const satisfies Record<AdminPermission, true>;

export const ADMIN_PERMISSIONS = Object.keys(ADMIN_PERMISSION_MEMBERSHIP) as AdminPermission[];

export function isAdminPermission(value: string): value is AdminPermission {
  return Object.prototype.hasOwnProperty.call(ADMIN_PERMISSION_MEMBERSHIP, value);
}

const ADMIN_APPROVAL_STATUS_MEMBERSHIP = {
  PENDING: true,
  APPROVED: true,
  REJECTED: true,
  EXECUTING: true,
  EXECUTED: true,
  FAILED: true,
} as const satisfies Record<AdminApprovalStatus, true>;

export const ADMIN_APPROVAL_STATUSES = Object.keys(
  ADMIN_APPROVAL_STATUS_MEMBERSHIP,
) as AdminApprovalStatus[];
