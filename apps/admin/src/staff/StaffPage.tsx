import { useMemo, useState } from 'react';
import { useLocation, useSearch } from 'wouter';

import { EmptyState, ErrorState, LoadingState } from '../components/feedback/AdminStates';
import { AdminMetricStrip } from '../components/layout/AdminMetricStrip';
import { PageScaffold } from '../components/layout/PageScaffold';
import { ResponsiveMasterDetail } from '../components/layout/ResponsiveMasterDetail';
import { detailIdFromPath, detailPath } from '../components/layout/detailRoute';
import { AdminDialog } from '../components/overlay/AdminDialog';
import { useShopScope } from '../shops/ShopScopeProvider';
import { isPendingApprovalResult } from '../lib/retainedCommandIds';
import { EmployeeDetailPage, type StaffDetailSection } from './EmployeeDetailPage';
import { staffSummaryMetrics } from './staffSummaryMetrics';
import { parseStaffMoneyMinor } from './staffMoney';
import { useStaff, type StaffApiCommandDraft } from './useStaff';
import './staff.css';

function readableError(error: unknown): string | null {
  if (!error) return null;
  const raw = error instanceof Error ? error.message : String(error);
  return raw.trim().replaceAll('_', ' ').replaceAll('-', ' ') || 'Staff action failed';
}

function employeeInitials(displayName: string): string {
  return displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((name) => name.charAt(0).toLocaleUpperCase())
    .join('');
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

type EmployeeOnboardingStep = 'identity' | 'shops' | 'employment' | 'review';

function optionalCompensationMinor(raw: string): number | null {
  if (!raw.trim()) return null;
  const minor = parseStaffMoneyMinor(raw);
  if (minor === null) throw new Error('invalid_compensation_rate');
  return minor;
}

function readPendingOnboarding(search: string, shopId: string | undefined): string | null {
  const params = new URLSearchParams(search);
  const employeeId = params.get('pendingEmployee');
  return employeeId && params.get('pendingShop') === shopId && /^[0-9a-f-]{36}$/i.test(employeeId)
    ? employeeId
    : null;
}

export function StaffPage() {
  const { scope, principal } = useShopScope();
  const shopId = scope.kind === 'shop' ? scope.shopId : undefined;
  const [location, navigate] = useLocation();
  const search = useSearch();
  const selectedSection = staffSectionFromSearch(search);
  const selectedId = detailIdFromPath(location, '/staff');
  const [createOpen, setCreateOpen] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState<EmployeeOnboardingStep>('identity');
  const [onboardingShopIds, setOnboardingShopIds] = useState<string[]>(shopId ? [shopId] : []);
  const [createdEmployeeId, setCreatedEmployeeId] = useState<string | null>(() =>
    readPendingOnboarding(search, shopId),
  );
  const [assignedShopIds, setAssignedShopIds] = useState<string[]>([]);
  const [provisionedShopIds, setProvisionedShopIds] = useState<string[]>([]);
  const [employeePinApplied, setEmployeePinApplied] = useState(false);
  const [compensationConfigured, setCompensationConfigured] = useState(false);
  const [newEmployeePin, setNewEmployeePin] = useState('');
  const [confirmEmployeePin, setConfirmEmployeePin] = useState('');
  const [setupAdminPin, setSetupAdminPin] = useState('');
  const [newEmployeePinCommandId, setNewEmployeePinCommandId] = useState(() => crypto.randomUUID());
  const [onboardingBusy, setOnboardingBusy] = useState(false);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const [approvalNotice, setApprovalNotice] = useState<string | null>(null);
  const [newEmployeeCompensationType, setNewEmployeeCompensationType] = useState<
    'MONTHLY' | 'HOURLY'
  >('MONTHLY');
  const [newEmployeeRate, setNewEmployeeRate] = useState('');
  const [newEmployeeEffectiveFrom, setNewEmployeeEffectiveFrom] = useState('');
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [newEmployeeName, setNewEmployeeName] = useState('');
  const [newEmployeePhone, setNewEmployeePhone] = useState('');
  const [newEmployeeHireDate, setNewEmployeeHireDate] = useState('');
  const [newEmployeeNotes, setNewEmployeeNotes] = useState('');
  const staff = useStaff(shopId, selectedId ?? createdEmployeeId);
  const shopChoices = useMemo(
    () => staff.workspaceQuery.data?.shops ?? [],
    [staff.workspaceQuery.data?.shops],
  );

  const onboardingShops = shopChoices.filter((shop) => principal.shopIds.includes(shop.id));

  const rows = useMemo(
    () => staff.workspaceQuery.data?.employees.rows ?? [],
    [staff.workspaceQuery.data],
  );
  const visibleRows = useMemo(() => {
    const term = employeeSearch.trim().toLocaleLowerCase();
    return rows.filter((employee) => {
      if (roleFilter !== 'all' && employee.role !== roleFilter) return false;
      if (statusFilter === 'active' && !employee.active) return false;
      if (statusFilter === 'suspended' && employee.active) return false;
      return (
        !term ||
        [employee.displayName, employee.phone ?? '', roleLabel(employee.role)].some((value) =>
          value.toLocaleLowerCase().includes(term),
        )
      );
    });
  }, [rows, employeeSearch, roleFilter, statusFilter]);
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
  const canProvisionWorker =
    canManage && (principal.role === 'OWNER' || principal.role === 'ADMIN');
  const canPay = principal.permissions.includes('staff.payments');
  const detail = staff.detailQuery.data;
  const actionError =
    readableError(staff.sensitiveCommand.error) ?? readableError(staff.command.error);

  const execute = (command: StaffApiCommandDraft) => staff.command.mutate(command);
  const executeSensitive = async (command: StaffApiCommandDraft, pin: string) => {
    setApprovalNotice(null);
    const result = await staff.sensitiveCommand.mutateAsync({ draft: command, pin });
    if (command.type !== 'payment.record' && isPendingApprovalResult(result)) {
      setApprovalNotice('Pending second-person approval; the change has not been applied.');
    }
    return result;
  };

  async function createEmployee() {
    const displayName = newEmployeeName.trim();
    if (!displayName || onboardingBusy || !shopId) return;
    if (!canProvisionWorker) {
      setOnboardingError('An Owner or Admin must provision Operations access during creation.');
      return;
    }
    if (!/^\d{4,12}$/.test(newEmployeePin) || newEmployeePin !== confirmEmployeePin) {
      setOnboardingError('Enter matching 4–12 digit employee Operations PINs.');
      return;
    }
    if (!/^\d{4,12}$/.test(setupAdminPin)) {
      setOnboardingError('Enter your Admin PIN to activate Operations access.');
      return;
    }
    setOnboardingBusy(true);
    setOnboardingError(null);
    try {
      const rateMinor = optionalCompensationMinor(newEmployeeRate);
      if (rateMinor !== null && !newEmployeeEffectiveFrom) {
        throw new Error('compensation_effective_date_required');
      }
      let employeeId = createdEmployeeId;
      if (!employeeId) {
        const result = await staff.command.mutateAsync({
          type: 'employee.create',
          shopId,
          displayName,
          phone: newEmployeePhone.trim() || null,
          hireDate: newEmployeeHireDate || null,
          notes: newEmployeeNotes.trim() || null,
          role: 'STAFF',
        });
        if (!result.ok || !result.employeeId || result.state === 'PENDING_APPROVAL') {
          throw new Error('employee_creation_unconfirmed');
        }
        employeeId = result.employeeId;
        setCreatedEmployeeId(employeeId);
        window.history.replaceState(
          window.history.state,
          '',
          `/staff?pendingEmployee=${encodeURIComponent(employeeId)}&pendingShop=${encodeURIComponent(shopId)}`,
        );
      }

      const completed = new Set(assignedShopIds);
      for (const assignedShopId of onboardingShopIds) {
        if (assignedShopId === shopId || completed.has(assignedShopId)) continue;
        const result = await staff.command.mutateAsync({
          type: 'employee.assign-shop',
          employeeId,
          shopId: assignedShopId,
        });
        if (!result.ok || result.state === 'PENDING_APPROVAL') {
          throw new Error('employee_assignment_unconfirmed');
        }
        completed.add(assignedShopId);
        setAssignedShopIds([...completed]);
      }

      if (rateMinor !== null && !compensationConfigured) {
        const result = await staff.command.mutateAsync({
          type: 'compensation.set',
          employeeId,
          shopId,
          compensationType: newEmployeeCompensationType,
          rateMinor,
          effectiveFrom: newEmployeeEffectiveFrom,
        });
        if (!result.ok || result.state === 'PENDING_APPROVAL') {
          throw new Error('compensation_setup_unconfirmed');
        }
        setCompensationConfigured(true);
      }
      if (!employeePinApplied) {
        const pinResult = await staff.sensitiveCommand.mutateAsync({
          draft: {
            type: 'employee.pin',
            employeeId,
            shopId,
            newPin: newEmployeePin,
            commandId: newEmployeePinCommandId,
          },
          pin: setupAdminPin,
        });
        if (!pinResult.ok || isPendingApprovalResult(pinResult)) {
          throw new Error('Employee PIN is pending approval; Operations access is not ready.');
        }
        setEmployeePinApplied(true);
      }
      const provisioned = new Set(provisionedShopIds);
      for (const assignedShopId of onboardingShopIds) {
        if (provisioned.has(assignedShopId)) continue;
        const result = await staff.command.mutateAsync({
          type: 'employee.provision-worker',
          employeeId,
          shopId: assignedShopId,
        });
        if (
          !result.ok ||
          isPendingApprovalResult(result) ||
          !result.workerId ||
          result.shopId !== assignedShopId
        ) {
          throw new Error(
            'Operations worker identity not confirmed for every assigned shop. Retry setup.',
          );
        }
        provisioned.add(assignedShopId);
        setProvisionedShopIds([...provisioned]);
      }
      setCreateOpen(false);
      setOnboardingStep('identity');
      setCreatedEmployeeId(null);
      setAssignedShopIds([]);
      setProvisionedShopIds([]);
      setEmployeePinApplied(false);
      setCompensationConfigured(false);
      setNewEmployeePin('');
      setConfirmEmployeePin('');
      setSetupAdminPin('');
      setNewEmployeePinCommandId(crypto.randomUUID());
      setNewEmployeeName('');
      setNewEmployeePhone('');
      setNewEmployeeHireDate('');
      setNewEmployeeNotes('');
      setNewEmployeeRate('');
      setNewEmployeeEffectiveFrom('');
      // Clear the incomplete-onboarding marker only after every trusted setup
      // command succeeds. Back navigation must not resurrect a completed draft.
      window.history.replaceState(window.history.state, '', '/staff');
      navigate(`${detailPath('/staff', employeeId)}?section=permissions`);
    } catch (error) {
      setOnboardingError(readableError(error) ?? 'Employee onboarding could not be completed');
    } finally {
      setOnboardingBusy(false);
    }
  }

  function advanceOnboarding() {
    setOnboardingError(null);
    if (onboardingStep === 'identity') {
      if (!newEmployeeName.trim()) return;
      setOnboardingStep('shops');
    } else if (onboardingStep === 'shops') {
      if (!onboardingShopIds.includes(shopId!)) {
        setOnboardingError('The current shop must remain assigned');
        return;
      }
      setOnboardingStep('employment');
    } else if (onboardingStep === 'employment') {
      try {
        const rate = optionalCompensationMinor(newEmployeeRate);
        if (rate !== null && !newEmployeeEffectiveFrom) {
          throw new Error('compensation_effective_date_required');
        }
        if (!/^\d{4,12}$/.test(newEmployeePin)) {
          throw new Error('Employee Operations PIN must be 4–12 digits');
        }
        if (newEmployeePin !== confirmEmployeePin) {
          throw new Error('PINs do not match');
        }
        if (!/^\d{4,12}$/.test(setupAdminPin)) {
          throw new Error('Admin PIN must be 4–12 digits');
        }
        if (!canProvisionWorker) {
          throw new Error(
            'Owner or Admin access is required for immediate Operations provisioning',
          );
        }
        setOnboardingStep('review');
      } catch (error) {
        setOnboardingError(readableError(error) ?? 'Invalid employment or Operations setup');
      }
    } else {
      void createEmployee();
    }
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
            disabled={
              Boolean(createdEmployeeId && !newEmployeeName.trim()) &&
              (staff.detailQuery.isLoading || staff.detailQuery.isError)
            }
            onClick={() => {
              if (createdEmployeeId && !newEmployeeName.trim()) {
                const pending = staff.detailQuery.data;
                if (!pending || pending.id !== createdEmployeeId) {
                  setOnboardingError('Saved employee could not be verified. Reload and retry.');
                  return;
                }
                setNewEmployeeName(pending.displayName);
                setNewEmployeePhone(pending.phone ?? '');
                setNewEmployeeHireDate(pending.hireDate ?? '');
                setNewEmployeeNotes(pending.notes ?? '');
                const linked = pending.assignments
                  .filter((assignment) => assignment.assigned)
                  .map((assignment) => assignment.shopId);
                setOnboardingShopIds([...new Set([shopId, ...linked])]);
                setAssignedShopIds(linked.filter((id) => id !== shopId));
                setProvisionedShopIds(
                  pending.operationsIdentities
                    .filter((identity) => identity.kind === 'LINKED' && identity.workerActive)
                    .map((identity) => identity.shopId),
                );
                setCompensationConfigured(pending.compensation.length > 0);
                setNewEmployeeRate('');
                setNewEmployeeEffectiveFrom('');
                setEmployeePinApplied(false);
                setSetupAdminPin('');
                setNewEmployeePin('');
                setConfirmEmployeePin('');
                setNewEmployeePinCommandId(crypto.randomUUID());
                setOnboardingError(null);
                setOnboardingStep('employment');
                setCreateOpen(true);
                return;
              }
              if (createdEmployeeId) {
                setOnboardingStep('review');
                setOnboardingError(null);
                setCreateOpen(true);
                return;
              }
              setOnboardingStep('identity');
              setOnboardingShopIds([shopId]);
              setAssignedShopIds([]);
              setOnboardingError(null);
              setCreateOpen(true);
            }}
          >
            {createdEmployeeId && !newEmployeeName.trim()
              ? 'Complete employee setup'
              : 'Add employee'}
          </button>
        ) : undefined
      }
    >
      {actionError && !createOpen ? <p role="alert">{actionError}</p> : null}
      {approvalNotice ? <p role="status">{approvalNotice}</p> : null}

      {staff.workspaceQuery.isSuccess ? (
        <AdminMetricStrip
          label="Staff summary"
          metrics={staffSummaryMetrics(
            rows,
            shopId,
            staff.workspaceQuery.data.employees.nextCursor === null,
            staff.workspaceQuery.data.pendingLeaveCount ?? null,
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
                <div className="admin-staff-directory__filters">
                  <label>
                    <span>Role</span>
                    <select
                      aria-label="Role (loaded results)"
                      value={roleFilter}
                      onChange={(event) => setRoleFilter(event.currentTarget.value)}
                    >
                      <option value="all">All roles</option>
                      <option value="OWNER">Owner</option>
                      <option value="ADMIN">Administrator</option>
                      <option value="MANAGER">Manager</option>
                      <option value="STAFF">Staff</option>
                    </select>
                  </label>
                  <label>
                    <span>Status</span>
                    <select
                      aria-label="Status (loaded results)"
                      value={statusFilter}
                      onChange={(event) => setStatusFilter(event.currentTarget.value)}
                    >
                      <option value="all">All statuses</option>
                      <option value="active">Active</option>
                      <option value="suspended">Suspended</option>
                    </select>
                  </label>
                </div>
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
                  <span className="admin-staff-person">
                    <span className="admin-staff-person__avatar" aria-hidden="true">
                      {employeeInitials(employee.displayName)}
                    </span>
                    <span className="admin-staff-person__text">
                      <strong>{employee.displayName}</strong>
                      <small>
                        {roleLabel(employee.role)} · {employee.shopIds.length} shop
                        {employee.shopIds.length === 1 ? '' : 's'}
                      </small>
                    </span>
                  </span>
                  <span className="admin-staff-row__states">
                    <span className="admin-staff-status-chip" data-active={employee.active}>
                      {employee.active ? 'Active' : 'Suspended'}
                    </span>
                    {employee.operationsSetupRequiredShopIds.includes(shopId) ? (
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
                canProvisionWorker={canProvisionWorker}
                canPay={canPay}
                financeAccounts={staff.workspaceQuery.data?.financeAccounts ?? []}
                workers={staff.workspaceQuery.data?.workers ?? []}
                shops={shopChoices}
                onCommand={execute}
                onVerifiedScheduleCommand={(command) => staff.command.mutateAsync(command)}
                onVerifiedStaffCommand={(command) => staff.command.mutateAsync(command)}
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
          description="Set up the profile, authorized shops, employee Operations PIN and pay in one flow. Save only after worker access is confirmed."
          onOpenChange={(open) => {
            if (!onboardingBusy && !staff.command.isPending) setCreateOpen(open);
          }}
        >
          <form
            className="admin-form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              advanceOnboarding();
            }}
          >
            <nav className="admin-staff-onboarding-steps" aria-label="Employee onboarding steps">
              {(['identity', 'shops', 'employment', 'review'] as const).map((step, index) => (
                <span key={step} aria-current={onboardingStep === step ? 'step' : undefined}>
                  {index + 1}. {step.charAt(0).toUpperCase() + step.slice(1)}
                </span>
              ))}
            </nav>
            {onboardingStep === 'identity' ? (
              <>
                <h3>Identity</h3>
                <label className="admin-field">
                  <span>Name</span>
                  <input
                    autoFocus
                    value={newEmployeeName}
                    disabled={Boolean(createdEmployeeId)}
                    onChange={(event) => setNewEmployeeName(event.target.value)}
                    required
                  />
                </label>
                <label className="admin-field">
                  <span>Phone</span>
                  <input
                    value={newEmployeePhone}
                    disabled={Boolean(createdEmployeeId)}
                    onChange={(event) => setNewEmployeePhone(event.target.value)}
                  />
                </label>
                <label className="admin-field">
                  <span>Hire date</span>
                  <input
                    type="date"
                    value={newEmployeeHireDate}
                    disabled={Boolean(createdEmployeeId)}
                    onChange={(event) => setNewEmployeeHireDate(event.currentTarget.value)}
                  />
                </label>
                <label className="admin-field">
                  <span>Internal notes</span>
                  <textarea
                    maxLength={2000}
                    value={newEmployeeNotes}
                    disabled={Boolean(createdEmployeeId)}
                    onChange={(event) => setNewEmployeeNotes(event.currentTarget.value)}
                  />
                </label>
                <p>
                  New employees start as Staff. Elevated access requires an approved role change.
                </p>
              </>
            ) : null}
            {onboardingStep === 'shops' ? (
              <fieldset className="admin-staff-onboarding-shops">
                <legend>Select assigned shops</legend>
                <p>Only shops in your authorized scope are available.</p>
                {onboardingShops.map((shop) => (
                  <label key={shop.id}>
                    <input
                      type="checkbox"
                      checked={onboardingShopIds.includes(shop.id)}
                      disabled={onboardingBusy || shop.id === shopId || Boolean(createdEmployeeId)}
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        setOnboardingShopIds((current) =>
                          checked
                            ? [...new Set([...current, shop.id])]
                            : current.filter((id) => id !== shop.id),
                        );
                      }}
                    />
                    {shop.name}
                  </label>
                ))}
                {onboardingShops.length === 0 ? <p>Current shop only.</p> : null}
              </fieldset>
            ) : null}
            {onboardingStep === 'employment' ? (
              <>
                <h3>Employment setup</h3>
                <p>Compensation is optional here and can be configured later in the Pay tab.</p>
                <label className="admin-field">
                  <span>Compensation type</span>
                  <select
                    value={newEmployeeCompensationType}
                    disabled={Boolean(createdEmployeeId && compensationConfigured)}
                    onChange={(event) =>
                      setNewEmployeeCompensationType(event.target.value as 'MONTHLY' | 'HOURLY')
                    }
                  >
                    <option value="MONTHLY">Monthly</option>
                    <option value="HOURLY">Hourly</option>
                  </select>
                </label>
                <label className="admin-field">
                  <span>Rate (EGP, optional)</span>
                  <input
                    inputMode="decimal"
                    value={newEmployeeRate}
                    disabled={Boolean(createdEmployeeId && compensationConfigured)}
                    onChange={(event) => setNewEmployeeRate(event.target.value)}
                  />
                </label>
                <label className="admin-field">
                  <span>Effective from</span>
                  <input
                    type="date"
                    value={newEmployeeEffectiveFrom}
                    disabled={Boolean(createdEmployeeId && compensationConfigured)}
                    onChange={(event) => setNewEmployeeEffectiveFrom(event.target.value)}
                  />
                </label>
                <section
                  className="admin-staff-onboarding-security"
                  aria-label="Operations access setup"
                >
                  <h3>Operations access — ready on save</h3>
                  <p>
                    Set the employee PIN now. Your Admin PIN confirms secure setup; neither PIN is
                    stored in browser storage.
                  </p>
                  <label className="admin-field">
                    <span>Employee Operations PIN</span>
                    <input
                      type="password"
                      inputMode="numeric"
                      autoComplete="new-password"
                      minLength={4}
                      maxLength={12}
                      value={newEmployeePin}
                      onChange={(event) => {
                        setNewEmployeePin(event.target.value);
                        setEmployeePinApplied(false);
                        setNewEmployeePinCommandId(crypto.randomUUID());
                      }}
                      required
                    />
                  </label>
                  <label className="admin-field">
                    <span>Confirm Operations PIN</span>
                    <input
                      type="password"
                      inputMode="numeric"
                      autoComplete="new-password"
                      minLength={4}
                      maxLength={12}
                      value={confirmEmployeePin}
                      onChange={(event) => setConfirmEmployeePin(event.target.value)}
                      required
                    />
                  </label>
                  <label className="admin-field">
                    <span>Admin PIN for employee setup</span>
                    <input
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      minLength={4}
                      maxLength={12}
                      value={setupAdminPin}
                      onChange={(event) => setSetupAdminPin(event.target.value)}
                      required
                    />
                  </label>
                  {!canProvisionWorker ? (
                    <p role="alert">
                      An Owner or Admin must create employees who can immediately log in to
                      Operations.
                    </p>
                  ) : null}
                </section>
              </>
            ) : null}
            {onboardingStep === 'review' ? (
              <section
                className="admin-staff-onboarding-review"
                aria-label="Employee onboarding review"
              >
                <h3>Review employee setup</h3>
                <p>
                  <strong>{newEmployeeName.trim()}</strong> · Staff
                </p>
                <p>{newEmployeePhone.trim() || 'No phone provided'}</p>
                <p>{newEmployeeHireDate || 'Hire date not provided'}</p>
                <p>
                  Assigned shops:{' '}
                  {onboardingShopIds
                    .map(
                      (id) =>
                        onboardingShops.find((shop) => shop.id === id)?.name ?? 'Current shop',
                    )
                    .join(', ')}
                </p>
                <p>
                  {newEmployeeRate.trim()
                    ? 'Compensation will be recorded using the selected rate and effective date.'
                    : 'Compensation will be configured later.'}
                </p>
                <p>
                  Operations access will be ready in all selected shops after the employee PIN is
                  verified and workers are provisioned. If approval or setup fails, save remains
                  incomplete and the draft can be resumed without creating a second employee.
                </p>
                {createdEmployeeId ? (
                  <p>
                    Profile created. Resume remaining setup without creating a duplicate employee.
                  </p>
                ) : null}
              </section>
            ) : null}
            {onboardingError || staff.command.isError ? (
              <p role="alert">{onboardingError ?? readableError(staff.command.error)}</p>
            ) : null}
            <div className="admin-inline-actions">
              <button
                className="admin-secondary-button"
                type="button"
                disabled={onboardingBusy}
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </button>
              {onboardingStep !== 'identity' ? (
                <button
                  className="admin-secondary-button"
                  type="button"
                  disabled={onboardingBusy || Boolean(createdEmployeeId)}
                  onClick={() =>
                    setOnboardingStep(
                      onboardingStep === 'review'
                        ? 'employment'
                        : onboardingStep === 'employment'
                          ? 'shops'
                          : 'identity',
                    )
                  }
                >
                  Back
                </button>
              ) : null}
              <button
                className="admin-primary-button"
                type="submit"
                disabled={
                  onboardingBusy || (onboardingStep === 'identity' && !newEmployeeName.trim())
                }
              >
                {onboardingStep === 'review'
                  ? onboardingBusy
                    ? 'Saving…'
                    : 'Save employee & enable Operations'
                  : 'Continue'}
              </button>
            </div>
          </form>
        </AdminDialog>
      ) : null}
    </PageScaffold>
  );
}
