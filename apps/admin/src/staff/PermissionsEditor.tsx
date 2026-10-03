import { ADMIN_PERMISSIONS, type EmployeeDetail } from '@tux/admin-contracts';

import type { StaffCommandDraft } from './SchedulePage';

export function PermissionsEditor({
  employee,
  shopId = employee.assignments[0]?.shopId ?? '',
  canManage,
  actorPin = '',
  onCommand,
  onSensitiveCommand,
}: {
  employee: EmployeeDetail;
  shopId?: string;
  canManage: boolean;
  actorPin?: string;
  onCommand?(command: StaffCommandDraft): void;
  onSensitiveCommand?(command: StaffCommandDraft, pin: string): void;
}) {
  const dispatch = (command: StaffCommandDraft) => {
    if (onSensitiveCommand) onSensitiveCommand(command, actorPin);
    else onCommand?.(command);
  };
  const requiresPin = Boolean(onSensitiveCommand);
  return (
    <section aria-label="Permissions">
      <h3>Permissions</h3>
      <p>Advanced permission overrides are audited and version-fenced.</p>
      {requiresPin && !actorPin ? (
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
          const disabled = !canManage || (requiresPin && !actorPin);
          return (
            <article className="admin-more-card" key={permission}>
              <strong>{permission}</strong>
              <span>{overrideState}</span>
              <div>
                <button
                  className="admin-secondary-button"
                  type="button"
                  disabled={disabled || explicitlyAllowed}
                  onClick={() =>
                    dispatch({
                      type: 'employee.permission',
                      employeeId: employee.id,
                      shopId,
                      permissionKey: permission,
                      effect: 'ALLOW',
                      expectedVersion: employee.profileVersion,
                    })
                  }
                >
                  Allow
                </button>
                <button
                  className="admin-secondary-button"
                  type="button"
                  disabled={disabled || explicitlyDenied}
                  onClick={() =>
                    dispatch({
                      type: 'employee.permission',
                      employeeId: employee.id,
                      shopId,
                      permissionKey: permission,
                      effect: 'DENY',
                      expectedVersion: employee.profileVersion,
                    })
                  }
                >
                  Deny
                </button>
                <button
                  className="admin-secondary-button"
                  type="button"
                  disabled={disabled || !hasExplicitOverride}
                  onClick={() =>
                    dispatch({
                      type: 'employee.permission',
                      employeeId: employee.id,
                      shopId,
                      permissionKey: permission,
                      effect: 'INHERIT',
                      expectedVersion: employee.profileVersion,
                    })
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
