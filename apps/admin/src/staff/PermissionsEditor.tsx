import { ADMIN_PERMISSIONS, type EmployeeDetail } from '@tux/admin-contracts';

import type { StaffCommandDraft } from './SchedulePage';

export function PermissionsEditor({
  employee,
  shopId,
  canManage,
  actorPin,
  onSensitiveCommand,
}: {
  employee: EmployeeDetail;
  shopId: string;
  canManage: boolean;
  actorPin: string;
  onSensitiveCommand(command: StaffCommandDraft, pin: string): void;
}) {
  return (
    <section aria-label="Permissions">
      <h3>Permissions</h3>
      <p>Advanced permission overrides are audited, version-fenced and require recent re-PIN.</p>
      {!actorPin ? (
        <p>Enter your Admin PIN on the Profile tab before changing permissions.</p>
      ) : null}
      <div className="admin-more-grid">
        {ADMIN_PERMISSIONS.map((permission) => {
          const allowed = employee.customPermissions.includes(permission);
          return (
            <label className="admin-more-card" key={permission}>
              <span>{permission}</span>
              <input
                type="checkbox"
                checked={allowed}
                disabled={!canManage || !actorPin}
                onChange={(event) =>
                  onSensitiveCommand(
                    {
                      type: 'employee.permission',
                      employeeId: employee.id,
                      shopId,
                      permissionKey: permission,
                      effect: event.target.checked ? 'ALLOW' : 'DENY',
                      expectedVersion: employee.profileVersion,
                    },
                    actorPin,
                  )
                }
              />
            </label>
          );
        })}
      </div>
    </section>
  );
}
