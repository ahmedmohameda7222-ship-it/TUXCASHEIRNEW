import { ADMIN_PERMISSIONS, type AdminPermission, type EmployeeDetail } from '@tux/admin-contracts';
import { useState } from 'react';

import { AdminDialog } from '../components/overlay/AdminDialog';
import type { StaffCommandDraft } from './SchedulePage';

const groupLabels: Record<string, string> = {
  orders: 'Orders',
  catalog: 'Catalog',
  inventory: 'Inventory',
  purchasing: 'Purchasing',
  customers: 'Customers',
  loyalty: 'Loyalty',
  promotions: 'Promotions',
  staff: 'Staff',
  delivery: 'Delivery',
  finance: 'Finance',
  reports: 'Reports',
  alerts: 'Alerts',
  shops: 'Shops',
  devices: 'Devices',
  settings: 'Settings',
  whatsapp: 'WhatsApp',
  audit: 'Audit',
  approvals: 'Approvals',
};

const actionLabels: Record<string, string> = {
  view: 'View',
  manage: 'Manage',
  cancel: 'Cancel orders',
  refund: 'Refund orders',
  edit: 'Edit',
  pricing: 'Change pricing',
  publish: 'Publish',
  adjust: 'Adjust',
  stocktake: 'Run stock counts',
  transfer: 'Transfer stock',
  override_negative: 'Override negative stock',
  receive: 'Receive purchases',
  merge: 'Merge customers',
  payments: 'Record staff payments',
  reconcile: 'Reconcile',
  manage_accounts: 'Manage accounts',
  review: 'Review approvals',
};

const permissionGroups = Object.entries(
  ADMIN_PERMISSIONS.reduce<Record<string, AdminPermission[]>>((groups, permission) => {
    const group = permission.split('.')[0]!;
    (groups[group] ??= []).push(permission);
    return groups;
  }, {}),
);

function permissionLabel(permission: AdminPermission): string {
  const [, action = permission] = permission.split('.');
  const label = actionLabels[action] ?? action.replaceAll('_', ' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function PermissionsEditor({
  employee,
  shopId = employee.assignments[0]?.shopId ?? '',
  canManage,
  onCommand,
  onSensitiveCommand,
}: {
  employee: EmployeeDetail;
  shopId?: string;
  canManage: boolean;
  onCommand?(command: StaffCommandDraft): void;
  onSensitiveCommand?(command: StaffCommandDraft, pin: string): void;
}) {
  const [pendingChange, setPendingChange] = useState<{
    permission: AdminPermission;
    effect: 'ALLOW' | 'DENY' | 'INHERIT';
  } | null>(null);
  const [actorPin, setActorPin] = useState('');

  function command(permission: AdminPermission, effect: 'ALLOW' | 'DENY' | 'INHERIT') {
    return {
      type: 'employee.permission',
      employeeId: employee.id,
      shopId,
      permissionKey: permission,
      effect,
      expectedVersion: employee.profileVersion,
    } satisfies StaffCommandDraft;
  }

  return (
    <section className="admin-staff-permissions-card" aria-label="Permissions">
      <div className="admin-staff-permissions-heading">
        <h3>Permission overrides</h3>
        <span>
          {employee.customPermissions.length + (employee.customDeniedPermissions?.length ?? 0)}{' '}
          customized
        </span>
      </div>
      <p>
        Role defaults provide the normal access level. Use an override only when this employee needs
        an exception.
      </p>
      <p role="status">
        {employee.customPermissions.length} explicit allowance(s) and{' '}
        {employee.customDeniedPermissions?.length ?? 0} explicit denial(s). Other capabilities
        follow the assigned role default for this shop.
      </p>
      <div className="admin-staff-permissions-grid">
        {permissionGroups.map(([group, permissions]) => {
          const overrideCount = permissions.filter(
            (permission) =>
              employee.customPermissions.includes(permission) ||
              employee.customDeniedPermissions?.includes(permission),
          ).length;
          return (
            <details
              className="admin-more-card admin-permission-group"
              key={group}
              open={overrideCount > 0}
            >
              <summary>
                <strong>{groupLabels[group] ?? group}</strong>
                <span>{overrideCount ? `${overrideCount} override(s)` : 'Role defaults'}</span>
              </summary>
              {permissions.map((permission) => {
                const value = employee.customPermissions.includes(permission)
                  ? 'ALLOW'
                  : employee.customDeniedPermissions?.includes(permission)
                    ? 'DENY'
                    : 'INHERIT';
                return (
                  <label className="admin-field" key={permission}>
                    <span>{permissionLabel(permission)}</span>
                    <select
                      value={value}
                      disabled={!canManage}
                      onChange={(event) => {
                        const effect = event.target.value as 'ALLOW' | 'DENY' | 'INHERIT';
                        if (onSensitiveCommand) setPendingChange({ permission, effect });
                        else onCommand?.(command(permission, effect));
                      }}
                    >
                      <option value="INHERIT">Role default</option>
                      <option value="ALLOW">Allowed</option>
                      <option value="DENY">Not allowed</option>
                    </select>
                  </label>
                );
              })}
            </details>
          );
        })}
      </div>
      <AdminDialog
        open={pendingChange !== null}
        variant="sheet"
        title="Confirm permission change"
        description={
          pendingChange
            ? `${permissionLabel(pendingChange.permission)} will use ${
                pendingChange.effect === 'ALLOW'
                  ? 'Allowed'
                  : pendingChange.effect === 'DENY'
                    ? 'Not allowed'
                    : 'Role default'
              }. Confirm with your Admin PIN.`
            : 'Confirm this permission change with your Admin PIN.'
        }
        onOpenChange={(open) => {
          if (!open) {
            setPendingChange(null);
            setActorPin('');
          }
        }}
      >
        <label className="admin-field">
          <span>Confirm with your Admin PIN</span>
          <input
            inputMode="numeric"
            type="password"
            value={actorPin}
            onChange={(event) => setActorPin(event.target.value)}
          />
        </label>
        <div className="admin-dialog__actions">
          <button
            className="admin-secondary-button"
            type="button"
            onClick={() => setPendingChange(null)}
          >
            Cancel
          </button>
          <button
            className="admin-primary-button"
            type="button"
            disabled={!actorPin}
            onClick={() => {
              if (!pendingChange || !onSensitiveCommand) return;
              onSensitiveCommand(command(pendingChange.permission, pendingChange.effect), actorPin);
              setPendingChange(null);
              setActorPin('');
            }}
          >
            Confirm change
          </button>
        </div>
      </AdminDialog>
    </section>
  );
}
