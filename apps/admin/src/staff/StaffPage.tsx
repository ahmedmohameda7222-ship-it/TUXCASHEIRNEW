import { useMemo, useState } from 'react';
import { useLocation, useSearch } from 'wouter';

import { EmptyState, ErrorState, LoadingState } from '../components/feedback/AdminStates';
import { AdminMetricStrip } from '../components/layout/AdminMetricStrip';
import { PageScaffold } from '../components/layout/PageScaffold';
import { ResponsiveMasterDetail } from '../components/layout/ResponsiveMasterDetail';
import { detailIdFromPath, detailPath } from '../components/layout/detailRoute';
import { AdminDialog } from '../components/overlay/AdminDialog';
import { useShopScope } from '../shops/ShopScopeProvider';
import { EmployeeDetailPage, type StaffDetailSection } from './EmployeeDetailPage';
import { staffSummaryMetrics } from './staffSummaryMetrics';
import { useStaff, type StaffApiCommandDraft } from './useStaff';
import './staff.css';

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
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [newEmployeeName, setNewEmployeeName] = useState('');
  const [newEmployeePhone, setNewEmployeePhone] = useState('');
  const [newEmployeeHireDate, setNewEmployeeHireDate] = useState('');
  const [newEmployeeNotes, setNewEmployeeNotes] = useState('');
  const staff = useStaff(shopId, selectedId);
  const shopChoices = useMemo(
    () => staff.workspaceQuery.data?.shops ?? [],
    [staff.workspaceQuery.data?.shops],
  );

  const rows = useMemo(
    () => staff.workspaceQuery.data?.employees.rows ?? [],
    [staff.workspaceQuery.data],
  );
  const visibleRows = useMemo(() => {
    const term = employeeSearch.trim().toLocaleLowerCase();
    if (!term) return rows;
    return rows.filter((employee) =>
      [employee.displayName, employee.phone ?? '', roleLabel(employee.role)].some((value) =>
        value.toLocaleLowerCase().includes(term),
      ),
    );
  }, [rows, employeeSearch]);
  const hasMoreStaff = staff.workspaceQuery.data?.employees.nextCursor != null;

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
        hireDate: newEmployeeHireDate || null,
        notes: newEmployeeNotes.trim() || null,
        role: 'STAFF',
      },
      {
        onSuccess: (result) => {
          setNewEmployeeName('');
          setNewEmployeePhone('');
          setNewEmployeeHireDate('');
          setNewEmployeeNotes('');
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

      {staff.workspaceQuery.isSuccess ? (
        <AdminMetricStrip
          label="Staff summary"
          metrics={staffSummaryMetrics(
            rows,
            shopId,
            staff.workspaceQuery.data.employees.nextCursor === null,
          )}
        />
      ) : null}

      <div className="admin-staff-workspace">
        <ResponsiveMasterDetail
          listLabel="Employees"
          detailLabel="Employee detail"
          detailActive={selectedId !== null}
          backHref="/staff"
          list={
            <div className="admin-record-list">
              <div className="admin-staff-directory__toolbar">
                <strong>Team directory</strong>
                <span>Select an employee to view their workspace</span>
                <input
                  type="search"
                  aria-label="Search employees (loaded results)"
                  placeholder="Search name, role or phone..."
                  value={employeeSearch}
                  onChange={(event) => setEmployeeSearch(event.currentTarget.value)}
                />
                {hasMoreStaff ? <p>Loaded results only</p> : null}
              </div>
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
              {rows.length === 0 &&
              !staff.workspaceQuery.isLoading &&
              !staff.workspaceQuery.isError ? (
                <EmptyState
                  title="No employees assigned to this shop"
                  description="Add or assign a staff profile to begin."
                />
              ) : null}
              {visibleRows.length === 0 && rows.length > 0 && !staff.workspaceQuery.isLoading ? (
                <EmptyState
                  title="No employees match search"
                  description="Try another name, role or phone from the loaded staff."
                />
              ) : null}
              {visibleRows.map((employee) => (
                <button
                  className={
                    employee.id === selectedId
                      ? 'admin-record-row admin-record-row--button is-selected'
                      : 'admin-record-row admin-record-row--button'
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
                  <span className="admin-staff-row__states">
                    <span>{employee.active ? 'Active' : 'Suspended'}</span>
                    {employee.operationsSetupRequiredShopIds.length > 0 ? (
                      <span
                        className="admin-staff-row__setup"
                        title="Operations setup is still required in assigned shops"
                      >
                        Setup needed
                      </span>
                    ) : null}
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
                canProvisionWorker={
                  canManage && (principal.role === 'OWNER' || principal.role === 'ADMIN')
                }
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
      </div>

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
            <label className="admin-field">
              <span>Hire date</span>
              <input
                type="date"
                value={newEmployeeHireDate}
                onChange={(event) => setNewEmployeeHireDate(event.currentTarget.value)}
              />
            </label>
            <label className="admin-field">
              <span>Internal notes</span>
              <textarea
                maxLength={2000}
                value={newEmployeeNotes}
                onChange={(event) => setNewEmployeeNotes(event.currentTarget.value)}
              />
            </label>
            <div className="admin-inline-actions">
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
