import type { AdminPermission } from '@tux/admin-contracts';

/**
 * Only commands actually wired to the canonical approval evaluator and
 * execution runner may be configured here. This is not a permission list.
 * Keep these identities synchronized with orderApproval.ts, staffApproval.ts,
 * and the trusted refund/return command RPCs.
 */
export type ApprovalRuleThresholdKind = 'minimumMinor' | 'minimumQuantityImpact';

export type ConfigurableApprovalAction = Readonly<{
  actionType: string;
  label: string;
  requesterPermission: AdminPermission;
  thresholdKind: ApprovalRuleThresholdKind | null;
}>;

export const APPROVAL_RULE_ACTIONS: readonly ConfigurableApprovalAction[] = [
  {
    actionType: 'ORDER_REFUND',
    label: 'Order refund',
    requesterPermission: 'orders.refund',
    thresholdKind: 'minimumMinor',
  },
  {
    actionType: 'ORDER_RETURN',
    label: 'Order return',
    requesterPermission: 'orders.refund',
    thresholdKind: 'minimumQuantityImpact',
  },
  {
    actionType: 'EMPLOYEE_PIN_CHANGE',
    label: 'Employee PIN change',
    requesterPermission: 'staff.manage',
    thresholdKind: null,
  },
  {
    actionType: 'EMPLOYEE_ROLE_CHANGE',
    label: 'Employee role change',
    requesterPermission: 'staff.manage',
    thresholdKind: null,
  },
  {
    actionType: 'EMPLOYEE_PERMISSION_CHANGE',
    label: 'Employee permission change',
    requesterPermission: 'staff.manage',
    thresholdKind: null,
  },
  {
    actionType: 'EMPLOYEE_SUSPEND',
    label: 'Employee suspension',
    requesterPermission: 'staff.manage',
    thresholdKind: null,
  },
  {
    actionType: 'INVENTORY_ADJUST',
    label: 'Inventory adjustment',
    requesterPermission: 'inventory.adjust',
    thresholdKind: 'minimumQuantityImpact',
  },
  {
    actionType: 'SETTINGS_PAYMENT_ZONE_CHANGE',
    label: 'Payment zone restrictions',
    requesterPermission: 'settings.manage',
    thresholdKind: null,
  },
  {
    actionType: 'SETTINGS_PAYMENT_METHOD_CHANGE',
    label: 'Payment method updates',
    requesterPermission: 'settings.manage',
    thresholdKind: null,
  },
  {
    actionType: 'SHOP_LIFECYCLE_CHANGE',
    label: 'Shop suspension / reactivation / archive',
    requesterPermission: 'shops.manage',
    thresholdKind: null,
  },
  {
    actionType: 'FINANCE_CASHIER_RECONCILIATION',
    label: 'Cashier reconciliation variance',
    requesterPermission: 'finance.reconcile',
    thresholdKind: 'minimumMinor',
  },
  {
    actionType: 'FINANCE_OWNER_WITHDRAWAL',
    label: 'Owner withdrawal',
    requesterPermission: 'finance.adjust',
    thresholdKind: 'minimumMinor',
  },
  {
    actionType: 'FINANCE_SNAPSHOT_ADJUST',
    label: 'Financial Z correction',
    requesterPermission: 'finance.adjust',
    thresholdKind: 'minimumMinor',
  },
  {
    actionType: 'STAFF_PAYMENT',
    label: 'Staff payment',
    requesterPermission: 'staff.payments',
    thresholdKind: 'minimumMinor',
  },
] as const;

export function configurableApprovalAction(
  actionType: string,
): ConfigurableApprovalAction | undefined {
  return APPROVAL_RULE_ACTIONS.find((entry) => entry.actionType === actionType);
}
