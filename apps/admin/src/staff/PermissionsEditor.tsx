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
          const explicitlyAllowed = employee.customPermissions.includes(permission);
          const explicitlyDenied = employee.customDeniedPermissions?.includes(permission) ?? false;
          const hasExplicitOverride = explicitlyAllowed || explicitlyDenied;
          const overrideState = explicitlyAllowed
            ? 'Explicit allow'
            : explicitlyDenied
              ? 'Explicit deny'
              : 'Role default · no explicit override';
          return (
            <article className="admin-more-card" key={permission}>
              <strong>{permission}</strong>
              <span>{overrideState}</span>
              <div>
                <button
                  className="admin-secondary-button"
                  type="button"
                  disabled={!canManage || !actorPin || explicitlyAllowed}
                  onClick={() =>
                    onSensitiveCommand(
                      {
                        type: 'employee.permission',
                        employeeId: employee.id,
                        shopId,
                        permissionKey: permission,
                        effect: 'ALLOW',
                        expectedVersion: employee.profileVersion,
                      },
                      actorPin,
                    )
                  }
                >
                  Allow
                </button>
                <button
                  className="admin-secondary-button"
                  type="button"
                  disabled={!canManage || !actorPin || explicitlyDenied}
                  onClick={() =>
                    onSensitiveCommand(
                      {
                        type: 'employee.permission',
                        employeeId: employee.id,
                        shopId,
                        permissionKey: permission,
                        effect: 'DENY',
                        expectedVersion: employee.profileVersion,
                      },
                      actorPin,
                    )
                  }
                >
                  Deny
                </button>
                <button
                  className="admin-secondary-button"
                  type="button"
                  disabled={!canManage || !actorPin || !hasExplicitOverride}
                  onClick={() =>
                    onSensitiveCommand(
                      {
                        type: 'employee.permission',
                        employeeId: employee.id,
                        shopId,
                        permissionKey: permission,
                        effect: 'INHERIT',
                        expectedVersion: employee.profileVersion,
                      },
                      actorPin,
                    )
                  }
                >
                  Use role default
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
