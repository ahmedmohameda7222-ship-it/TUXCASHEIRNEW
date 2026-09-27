import { ADMIN_PERMISSIONS, type EmployeeDetail } from '@tux/admin-contracts';

import type { StaffCommandDraft } from './SchedulePage';

export function PermissionsEditor({
  employee,
  shopId,
  canManage,
  onCommand,
}: {
  employee: EmployeeDetail;
  shopId: string;
  canManage: boolean;
  onCommand(command: StaffCommandDraft): void;
}) {
  return (
    <section aria-label="Permissions">
      <h3>Permissions</h3>
      <p>Advanced permission overrides are audited and version-fenced.</p>
      <div className="admin-more-grid">
        {ADMIN_PERMISSIONS.map((permission) => {
          const allowed = employee.customPermissions.includes(permission);
          return (
            <label className="admin-more-card" key={permission}>
              <span>{permission}</span>
              <input
                type="checkbox"
                checked={allowed}
                disabled={!canManage}
                onChange={(event) =>
                  onCommand({
                    type: 'employee.permission',
                    employeeId: employee.id,
                    shopId,
                    permissionKey: permission,
                    effect: event.target.checked ? 'ALLOW' : 'DENY',
                    expectedVersion: employee.profileVersion,
                  })
                }
              />
            </label>
          );
        })}
      </div>
    </section>
  );
}
