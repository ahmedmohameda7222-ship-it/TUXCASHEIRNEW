import { useEffect, useMemo, useState } from 'react';

import { PageScaffold } from '../components/layout/PageScaffold';
import { useShopScope } from '../shops/ShopScopeProvider';
import { EmployeeDetailPage } from './EmployeeDetailPage';
import { useStaff, type StaffApiCommandDraft } from './useStaff';

function readableError(error: unknown): string | null {
  if (!error) return null;
  const raw = error instanceof Error ? error.message : String(error);
  return raw.trim().replaceAll('_', ' ').replaceAll('-', ' ') || 'Staff action failed';
}

export function StaffPage() {
  const { scope, principal } = useShopScope();
  const shopId = scope.kind === 'shop' ? scope.shopId : undefined;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newEmployeeName, setNewEmployeeName] = useState('');
  const [newEmployeePhone, setNewEmployeePhone] = useState('');
  const staff = useStaff(shopId, selectedId);

  const rows = useMemo(
    () => staff.workspaceQuery.data?.employees.rows ?? [],
    [staff.workspaceQuery.data],
  );

  useEffect(() => {
    if (selectedId && rows.some((employee) => employee.id === selectedId)) return;
    setSelectedId(rows[0]?.id ?? null);
  }, [rows, selectedId]);

  if (!shopId) {
    return (
      <PageScaffold
        eyebrow="Workforce"
        title="Staff"
        description="Select a concrete shop to manage staff, attendance, leave, schedule and pay."
      />
    );
  }

  const canManage = principal.permissions.includes('staff.manage');
  const canPay = principal.permissions.includes('staff.payments');
  const detail = staff.detailQuery.data;
  const actionError =
    readableError(staff.sensitiveCommand.error) ?? readableError(staff.command.error);

  const execute = (command: StaffApiCommandDraft) => {
    staff.command.mutate(command);
  };

  const executeSensitive = (command: StaffApiCommandDraft, pin: string) => {
    staff.sensitiveCommand.mutate({ draft: command, pin });
  };

  return (
    <PageScaffold
      eyebrow="Workforce"
      title="Staff"
      description="Shop-scoped staff profiles, Operations identity, schedule, attendance, leave and recorded pay."
    >
      {actionError ? <p role="alert">{actionError}</p> : null}

      <div className="admin-inventory-layout">
        <section className="admin-inventory-list" aria-label="Employees">
          {canManage ? (
            <section
              className="admin-catalog-editor__section is-compact"
              aria-label="Create employee"
            >
              <h3>Add employee</h3>
              <p>
                New employees start as STAFF. Use the audited role-change flow after creation for
                elevated access.
              </p>
              <label className="admin-field">
                <span>Name</span>
                <input
                  value={newEmployeeName}
                  onChange={(event) => setNewEmployeeName(event.target.value)}
                />
              </label>
              <label className="admin-field">
                <span>Phone</span>
                <input
                  value={newEmployeePhone}
                  onChange={(event) => setNewEmployeePhone(event.target.value)}
                />
              </label>
              <button
                className="admin-primary-button"
                type="button"
                disabled={!newEmployeeName.trim() || staff.command.isPending}
                onClick={() =>
                  execute({
                    type: 'employee.create',
                    shopId,
                    displayName: newEmployeeName.trim(),
                    phone: newEmployeePhone.trim() || null,
                    hireDate: null,
                    notes: null,
                    role: 'STAFF',
                  })
                }
              >
                Add employee
              </button>
            </section>
          ) : null}
          {staff.workspaceQuery.isLoading ? <p>Loading staff…</p> : null}
          {staff.workspaceQuery.isError ? <p role="alert">Staff could not be loaded.</p> : null}
          {rows.length === 0 && !staff.workspaceQuery.isLoading ? (
            <div className="admin-empty-state">
              <strong>No employees assigned to this shop</strong>
              <span>Create or assign a staff profile to begin.</span>
            </div>
          ) : null}

          {rows.map((employee) => (
            <button
              className={
                employee.id === selectedId
                  ? 'admin-inventory-row is-selected'
                  : 'admin-inventory-row'
              }
              key={employee.id}
              type="button"
              onClick={() => setSelectedId(employee.id)}
            >
              <span>
                <strong>{employee.displayName}</strong>
                <small>
                  {employee.role} · {employee.shopIds.length} shop
                  {employee.shopIds.length === 1 ? '' : 's'}
                </small>
              </span>
              <span>
                {employee.active ? 'Active' : 'Suspended'}
                {employee.operationsSetupRequiredShopIds.length > 0 ? ' · Ops setup required' : ''}
              </span>
            </button>
          ))}
        </section>

        <section className="admin-inventory-inspector">
          {staff.detailQuery.isLoading ? <p>Loading employee…</p> : null}
          {staff.detailQuery.isError ? (
            <p role="alert">Employee detail could not be loaded.</p>
          ) : null}
          {detail ? (
            <EmployeeDetailPage
              key={`${detail.id}:${shopId}`}
              employee={detail}
              shopId={shopId}
              canManage={canManage}
              canPay={canPay}
              financeAccounts={staff.workspaceQuery.data?.financeAccounts ?? []}
              workers={staff.workspaceQuery.data?.workers ?? []}
              availableShopIds={principal.shopIds}
              onCommand={execute}
              onSensitiveCommand={executeSensitive}
            />
          ) : !staff.detailQuery.isLoading ? (
            <div className="admin-empty-state">
              <strong>Select an employee</strong>
              <span>Review profile, schedule, attendance, leave, pay and permissions.</span>
            </div>
          ) : null}
        </section>
      </div>
    </PageScaffold>
  );
}
