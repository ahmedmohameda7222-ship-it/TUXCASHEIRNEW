import { useMemo, useState } from 'react';
import { useLocation, useSearch } from 'wouter';

import { EmptyState, ErrorState, LoadingState } from '../components/feedback/AdminStates';
import { PageScaffold } from '../components/layout/PageScaffold';
import { ResponsiveMasterDetail } from '../components/layout/ResponsiveMasterDetail';
import { detailIdFromPath, detailPath } from '../components/layout/detailRoute';
import { AdminDialog } from '../components/overlay/AdminDialog';
import { useShopScope } from '../shops/ShopScopeProvider';
import { EmployeeDetailPage, type StaffDetailSection } from './EmployeeDetailPage';
import { useStaff, type StaffApiCommandDraft } from './useStaff';

function readableError(error: unknown): string | null {
  if (!error) return null;
  const raw = error instanceof Error ? error.message : String(error);
  return raw.trim().replaceAll('_', ' ').replaceAll('-', ' ') || 'Staff action failed';
}

function roleLabel(role: string): string {
  return role === 'OWNER'
    ? 'Owner'
    : role === 'ADMIN'
      ? 'Administrator'
      : role === 'MANAGER'
        ? 'Manager'
        : 'Staff';
}

export function staffSectionFromSearch(search: string): StaffDetailSection {
  const candidate = new URLSearchParams(search).get('section');
  switch (candidate) {
    case 'schedule':
    case 'attendance':
    case 'leave':
    case 'pay':
    case 'permissions':
      return candidate;
    default:
      return 'profile';
  }
}

export function StaffPage() {
  const { scope, principal } = useShopScope();
  const shopId = scope.kind === 'shop' ? scope.shopId : undefined;
  const [location, navigate] = useLocation();
  const search = useSearch();
  const selectedSection = staffSectionFromSearch(search);
  const selectedId = detailIdFromPath(location, '/staff');
  const [createOpen, setCreateOpen] = useState(false);
  const [newEmployeeName, setNewEmployeeName] = useState('');
  const [newEmployeePhone, setNewEmployeePhone] = useState('');
  const staff = useStaff(shopId, selectedId);
  const shopChoices = useMemo(
    () => staff.workspaceQuery.data?.shops ?? [],
    [staff.workspaceQuery.data?.shops],
  );

  const rows = useMemo(
    () => staff.workspaceQuery.data?.employees.rows ?? [],
    [staff.workspaceQuery.data],
  );

  if (!shopId) {
    return (
      <PageScaffold
        eyebrow="Workforce"
        title="Staff"
        description="Select a shop to manage staff, attendance, leave, schedules and pay."
      />
    );
  }

  const canManage = principal.permissions.includes('staff.manage');
  const canPay = principal.permissions.includes('staff.payments');
  const detail = staff.detailQuery.data;
  const actionError =
    readableError(staff.sensitiveCommand.error) ?? readableError(staff.command.error);

  const execute = (command: StaffApiCommandDraft) => staff.command.mutate(command);
  const executeSensitive = (command: StaffApiCommandDraft, pin: string) => {
    staff.sensitiveCommand.mutate({ draft: command, pin });
  };

  function createEmployee() {
    const displayName = newEmployeeName.trim();
    if (!displayName) return;
    staff.command.mutate(
      {
        type: 'employee.create',
        shopId,
        displayName,
        phone: newEmployeePhone.trim() || null,
        hireDate: null,
        notes: null,
        role: 'STAFF',
      },
      {
        onSuccess: (result) => {
          setNewEmployeeName('');
          setNewEmployeePhone('');
          setCreateOpen(false);
          if (result.ok && result.employeeId) navigate(detailPath('/staff', result.employeeId));
        },
      },
    );
  }

  return (
    <PageScaffold
      eyebrow="Workforce"
      title="Staff"
      description="Manage staff profiles, Operations access, schedules, attendance, leave and recorded pay."
      primaryAction={
        canManage ? (
          <button
            className="admin-primary-button"
            type="button"
            onClick={() => setCreateOpen(true)}
          >
            Add employee
          </button>
        ) : undefined
      }
    >
      {actionError ? <p role="alert">{actionError}</p> : null}

      <ResponsiveMasterDetail
        listLabel="Employees"
        detailLabel="Employee detail"
        detailActive={selectedId !== null}
        backHref="/staff"
        list={
          <div className="admin-inventory-list">
            {staff.workspaceQuery.isLoading ? <LoadingState title="Loading staff" /> : null}
            {staff.workspaceQuery.isError ? (
              <ErrorState
                title="Staff could not be loaded"
                action={
                  <button
                    className="admin-secondary-button"
                    type="button"
                    onClick={() => void staff.workspaceQuery.refetch()}
                  >
                    Retry
                  </button>
                }
              />
            ) : null}
            {rows.length === 0 && !staff.workspaceQuery.isLoading ? (
              <EmptyState
                title="No employees assigned to this shop"
                description="Add or assign a staff profile to begin."
              />
            ) : null}
            {rows.map((employee) => (
              <button
                className={
                  employee.id === selectedId
                    ? 'admin-inventory-row is-selected'
                    : 'admin-inventory-row'
                }
                aria-current={employee.id === selectedId ? 'true' : undefined}
                key={employee.id}
                type="button"
                onClick={() => navigate(detailPath('/staff', employee.id))}
              >
                <span>
                  <strong>{employee.displayName}</strong>
                  <small>
                    {roleLabel(employee.role)} · {employee.shopIds.length} shop
                    {employee.shopIds.length === 1 ? '' : 's'}
                  </small>
                </span>
                <span>
                  {employee.active ? 'Active' : 'Suspended'}
                  {employee.operationsSetupRequiredShopIds.length > 0
                    ? ' · Operations setup required'
                    : ''}
                </span>
              </button>
            ))}
          </div>
        }
        detail={
          staff.detailQuery.isLoading ? (
            <LoadingState title="Loading employee" />
          ) : staff.detailQuery.isError ? (
            <ErrorState
              title="Employee unavailable"
              description="This employee may not exist or may not be available in your current shop scope."
            />
          ) : detail ? (
            <EmployeeDetailPage
              key={`${detail.id}:${shopId}`}
              employee={detail}
              section={selectedSection}
              onSectionChange={(section) => {
                if (!selectedId) return;
                const path = detailPath('/staff', selectedId);
                navigate(section === 'profile' ? path : `${path}?section=${section}`);
              }}
              shopId={shopId}
              canManage={canManage}
              canPay={canPay}
              financeAccounts={staff.workspaceQuery.data?.financeAccounts ?? []}
              workers={staff.workspaceQuery.data?.workers ?? []}
              shops={shopChoices}
              onCommand={execute}
              onSensitiveCommand={executeSensitive}
            />
          ) : (
            <EmptyState
              title="Employee unavailable"
              description="Choose another employee from the list."
            />
          )
        }
        emptyDetail={
          <EmptyState
            title="Select an employee"
            description="Review profile, schedule, attendance, leave, pay and permissions."
          />
        }
      />

      {canManage ? (
        <AdminDialog
          open={createOpen}
          variant="sheet"
          title="Add employee"
          description="New employees start as Staff. Elevated access is granted separately through the controlled role-change flow."
          onOpenChange={(open) => {
            if (!staff.command.isPending) setCreateOpen(open);
          }}
        >
          <form
            className="admin-form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              createEmployee();
            }}
          >
            <label className="admin-field">
              <span>Name</span>
              <input
                autoFocus
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
            <div className="admin-inventory-page-actions">
              <button
                className="admin-secondary-button"
                type="button"
                disabled={staff.command.isPending}
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </button>
              <button
                className="admin-primary-button"
                type="submit"
                disabled={!newEmployeeName.trim() || staff.command.isPending}
              >
                {staff.command.isPending ? 'Adding…' : 'Add employee'}
              </button>
            </div>
          </form>
        </AdminDialog>
      ) : null}
    </PageScaffold>
  );
}
