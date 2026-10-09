import type {
  AdminRole,
  EmployeeDetail,
  StaffFinanceAccountChoice,
  StaffWorkerChoice,
} from '@tux/admin-contracts';
import { useState } from 'react';

import { AdminTabs } from '../components/navigation/AdminTabs';
import { AdminDialog } from '../components/overlay/AdminDialog';
import { AttendancePage } from './AttendancePage';
import { LeavePage } from './LeavePage';
import { PermissionsEditor } from './PermissionsEditor';
import { SchedulePage, type StaffCommandDraft } from './SchedulePage';
import { StaffMetricsPanel } from './StaffMetricsPanel';
import { StaffPaymentPage } from './StaffPaymentPage';

export type StaffDetailSection = 'profile' | 'schedule' | 'attendance' | 'leave' | 'pay' | 'permissions';
type StaffShopChoice = { id: string; name: string };

type LinkedOperationsIdentity = Extract<
  EmployeeDetail['operationsIdentities'][number],
  { kind: 'LINKED' }
>;

type SensitiveAction =
  | { kind: 'role' }
  | { kind: 'pin' }
  | { kind: 'status' }
  | { kind: 'restore'; identity: LinkedOperationsIdentity }
  | null;

function isInactiveLinkedOperationsIdentity(
  identity: EmployeeDetail['operationsIdentities'][number],
): identity is LinkedOperationsIdentity {
  return identity.kind === 'LINKED' && !identity.workerActive;
}

function roleLabel(role: AdminRole): string {
  return role === 'OWNER'
    ? 'Owner'
    : role === 'ADMIN'
      ? 'Administrator'
      : role === 'MANAGER'
        ? 'Manager'
        : 'Staff';
}

export function EmployeeDetailPage({
  employee,
  section,
  onSectionChange,
  shopId = employee.assignments[0]?.shopId ?? '',
  canManage,
  canPay,
  financeAccounts,
  workers,
  shops,
  onCommand,
  onSensitiveCommand,
}: {
  employee: EmployeeDetail;
  section: StaffDetailSection;
  onSectionChange(section: StaffDetailSection): void;
  shopId?: string;
  canManage: boolean;
  canPay: boolean;
  financeAccounts: readonly StaffFinanceAccountChoice[];
  workers: readonly StaffWorkerChoice[];
  shops: readonly StaffShopChoice[];
  onCommand(command: StaffCommandDraft): void;
  onSensitiveCommand(command: StaffCommandDraft, pin: string): void;
}) {
  const [sensitiveAction, setSensitiveAction] = useState<SensitiveAction>(null);
  const [actorPin, setActorPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [pinCommandId, setPinCommandId] = useState(() => crypto.randomUUID());
  const [roleDraft, setRoleDraft] = useState<AdminRole>(employee.role);
  const availableWorkers = workers.filter(
    (worker) =>
      worker.shopId === shopId &&
      (worker.linkedEmployeeId === null || worker.linkedEmployeeId === employee.id),
  );
  const [workerId, setWorkerId] = useState(availableWorkers[0]?.id ?? '');
  const [displayName, setDisplayName] = useState(employee.displayName);
  const [phone, setPhone] = useState(employee.phone ?? '');
  const [hireDate, setHireDate] = useState(employee.hireDate ?? '');
  const [notes, setNotes] = useState(employee.notes ?? '');
  const latestCompensation = employee.compensation[0] ?? null;
  const [compensationType, setCompensationType] = useState<'HOURLY' | 'MONTHLY'>(
    latestCompensation?.compensationType ?? 'MONTHLY',
  );
  const [compensationRate, setCompensationRate] = useState(
    latestCompensation ? String(latestCompensation.rateMinor / 100) : '',
  );
  const [compensationEffectiveFrom, setCompensationEffectiveFrom] = useState('');
  const availableShopIds = shops.map((shop) => shop.id);
  const unassignedShopIds = availableShopIds.filter(
    (candidate) => !employee.assignments.some((assignment) => assignment.shopId === candidate),
  );
  const [assignShopId, setAssignShopId] = useState(unassignedShopIds[0] ?? '');
  const setupRequired = employee.operationsIdentities.filter(
    (identity) => identity.kind === 'SETUP_REQUIRED',
  );
  const currentShopSetupRequired = setupRequired.some((identity) => identity.shopId === shopId);
  const otherShopSetupRequired = setupRequired.filter((identity) => identity.shopId !== shopId);
  const inactiveOperationsIdentities = employee.operationsIdentities.filter(
    isInactiveLinkedOperationsIdentity,
  );
  const operationsHealthy = setupRequired.length === 0 && inactiveOperationsIdentities.length === 0;
  const shopName = (id: string) => shops.find((shop) => shop.id === id)?.name ?? 'Authorized shop';

  const profileContent = (
    <>
      <section className="admin-catalog-editor__section">
        <h3>Profile</h3>
        <dl>
          <dt>Phone</dt>
          <dd>{employee.phone ?? 'Not set'}</dd>
          <dt>Hire date</dt>
          <dd>{employee.hireDate ?? 'Not set'}</dd>
          <dt>Assigned shops</dt>
          <dd>
            {employee.assignments.map((assignment) => shopName(assignment.shopId)).join(', ') ||
              'None'}
          </dd>
        </dl>
        {canManage ? (
          <section className="admin-catalog-editor__section is-compact">
            <h4>Edit profile</h4>
            <label className="admin-field">
              <span>Name</span>
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </label>
            <label className="admin-field">
              <span>Phone</span>
              <input value={phone} onChange={(event) => setPhone(event.target.value)} />
            </label>
            <label className="admin-field">
              <span>Hire date</span>
              <input
                type="date"
                value={hireDate}
                onChange={(event) => setHireDate(event.target.value)}
              />
            </label>
            <label className="admin-field">
              <span>Notes</span>
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
            </label>
            <button
              className="admin-primary-button"
              type="button"
              disabled={!displayName.trim()}
              onClick={() =>
                onCommand({
                  type: 'employee.update',
                  employeeId: employee.id,
                  shopId,
                  expectedVersion: employee.profileVersion,
                  displayName: displayName.trim(),
                  phone: phone.trim() || null,
                  hireDate: hireDate || null,
                  notes: notes.trim() || null,
                })
              }
            >
              Save profile
            </button>
          </section>
        ) : null}

        {canManage && unassignedShopIds.length > 0 ? (
          <section className="admin-catalog-editor__section is-compact">
            <h4>Assign another shop</h4>
            <label className="admin-field">
              <span>Shop</span>
              <select
                value={assignShopId}
                onChange={(event) => setAssignShopId(event.target.value)}
              >
                {unassignedShopIds.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {shopName(candidate)}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="admin-secondary-button"
              type="button"
              disabled={!assignShopId}
              onClick={() =>
                onCommand({
                  type: 'employee.assign-shop',
                  employeeId: employee.id,
                  shopId: assignShopId,
                })
              }
            >
              Assign shop
            </button>
          </section>
        ) : null}
      </section>
    </>
  );

  const compensationContent = (
    <>
      <section className="admin-catalog-editor__section is-compact">
        <h3>Compensation</h3>
        {latestCompensation ? (
          <p>
            Current: {latestCompensation.compensationType === 'HOURLY' ? 'Hourly' : 'Monthly'} ·{' '}
            {(latestCompensation.rateMinor / 100).toFixed(2)} EGP · effective{' '}
            {latestCompensation.effectiveFrom}
          </p>
        ) : (
          <p>No compensation record yet.</p>
        )}
        {canManage ? (
          <>
            <label className="admin-field">
              <span>Compensation type</span>
              <select
                value={compensationType}
                onChange={(event) =>
                  setCompensationType(event.target.value as 'HOURLY' | 'MONTHLY')
                }
              >
                <option value="HOURLY">Hourly</option>
                <option value="MONTHLY">Monthly</option>
              </select>
            </label>
            <label className="admin-field">
              <span>Rate (EGP)</span>
              <input
                inputMode="decimal"
                value={compensationRate}
                onChange={(event) => setCompensationRate(event.target.value)}
              />
            </label>
            <label className="admin-field">
              <span>Effective from</span>
              <input
                type="date"
                value={compensationEffectiveFrom}
                onChange={(event) => setCompensationEffectiveFrom(event.target.value)}
              />
            </label>
            <button
              className="admin-secondary-button"
              type="button"
              disabled={
                !compensationEffectiveFrom ||
                !Number.isFinite(Number(compensationRate)) ||
                Number(compensationRate) < 0
              }
              onClick={() =>
                onCommand({
                  type: 'compensation.set',
                  employeeId: employee.id,
                  shopId,
                  compensationType,
                  rateMinor: Math.round(Number(compensationRate) * 100),
                  effectiveFrom: compensationEffectiveFrom,
                })
              }
            >
              Record compensation
            </button>
          </>
        ) : null}
      </section>
      <StaffPaymentPage
        employee={employee}
        shopId={shopId}
        canPay={canPay}
        financeAccounts={financeAccounts}
        onCommand={onCommand}
      />
    </>
  );

  const accessContent = (
    <>
      <section className="admin-catalog-editor__section" aria-labelledby="staff-operations-access">
        <h3 id="staff-operations-access">Operations access</h3>
        {setupRequired.length > 0 ? (
          <div className="admin-empty-state">
            <strong>Operations setup required</strong>
            <span>
              A linked Operations worker is missing for{' '}
              {setupRequired.map((identity) => shopName(identity.shopId)).join(', ')}.
            </span>
            {currentShopSetupRequired && canManage && availableWorkers.length > 0 ? (
              <>
                <label className="admin-field">
                  <span>Operations worker</span>
                  <select value={workerId} onChange={(event) => setWorkerId(event.target.value)}>
                    {availableWorkers.map((worker) => (
                      <option key={worker.id} value={worker.id}>
                        {worker.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="admin-secondary-button"
                  type="button"
                  disabled={!workerId}
                  onClick={() =>
                    onCommand({
                      type: 'employee.link-worker',
                      employeeId: employee.id,
                      shopId,
                      workerId,
                    })
                  }
                >
                  Complete Operations setup
                </button>
              </>
            ) : currentShopSetupRequired && canManage ? (
              <span>No unlinked active Operations worker is available for this shop.</span>
            ) : null}
            {canManage && otherShopSetupRequired.length > 0 ? (
              <span>Switch to that shop to complete Operations setup.</span>
            ) : null}
          </div>
        ) : null}

        {inactiveOperationsIdentities.length > 0 ? (
          <div className="admin-empty-state">
            <strong>Operations access disabled</strong>
            <span>
              Restoring access requires your Admin PIN and the preserved linked worker identity.
            </span>
            {inactiveOperationsIdentities.map((identity) => (
              <article className="admin-more-card" key={identity.shopId}>
                <strong>{identity.workerName}</strong>
                <span>{shopName(identity.shopId)} · Operations access disabled</span>
                {canManage && employee.active ? (
                  <button
                    className="admin-secondary-button"
                    type="button"
                    onClick={() => setSensitiveAction({ kind: 'restore', identity })}
                  >
                    Restore Operations access
                  </button>
                ) : canManage ? (
                  <span>Reactivate the employee before restoring Operations access.</span>
                ) : null}
              </article>
            ))}
          </div>
        ) : null}

        {operationsHealthy ? <p>Operations access: Ready</p> : null}
      </section>

      <StaffMetricsPanel employee={employee} />

      {canManage ? (
        <section
          className="admin-catalog-editor__section is-compact"
          aria-labelledby="staff-sensitive-actions"
        >
          <h3 id="staff-sensitive-actions">Sensitive access actions</h3>
          <p>Each access change opens its own confirmation and asks for your Admin PIN.</p>
          <div className="admin-actions">
            <button
              className="admin-secondary-button"
              type="button"
              onClick={() => setSensitiveAction({ kind: 'role' })}
            >
              Change role
            </button>
            <button
              className="admin-secondary-button"
              type="button"
              onClick={() => setSensitiveAction({ kind: 'pin' })}
            >
              Reset employee PIN
            </button>
            <button
              className={employee.active ? 'admin-destructive-button' : 'admin-secondary-button'}
              type="button"
              onClick={() => setSensitiveAction({ kind: 'status' })}
            >
              {employee.active ? 'Suspend employee' : 'Reactivate employee'}
            </button>
          </div>
        </section>
      ) : null}
      <PermissionsEditor
        employee={employee}
        canManage={canManage}
        onCommand={onCommand}
        onSensitiveCommand={onSensitiveCommand}
      />
    </>
  );

  return (
    <article aria-label={`Employee ${employee.displayName}`}>
      <header className="admin-page__header">
        <div>
          <p className="admin-page__eyebrow">Staff profile</p>
          <h2>{employee.displayName}</h2>
          <p className="admin-page__description">
            {roleLabel(employee.role)} · {employee.active ? 'Active' : 'Suspended'}
          </p>
        </div>
      </header>

      <AdminTabs<StaffDetailSection>
        label="Employee detail sections"
        value={section}
        onChange={onSectionChange}
        tabs={[
          { id: 'profile', label: 'Profile', content: profileContent },
          {
            id: 'schedule',
            label: 'Schedule',
            content: (
              <SchedulePage
                employee={employee}
                shopId={shopId}
                canManage={canManage}
                onCommand={onCommand}
              />
            ),
          },
          {
            id: 'attendance',
            label: 'Attendance',
            content: (
              <AttendancePage
                employee={employee}
                shopId={shopId}
                canManage={canManage}
                onCommand={onCommand}
              />
            ),
          },
          {
            id: 'leave',
            label: 'Leave',
            content: (
              <LeavePage
                employee={employee}
                shopId={shopId}
                canManage={canManage}
                onCommand={onCommand}
              />
            ),
          },
          {
            id: 'pay',
            label: 'Pay / Compensation',
            content: compensationContent,
          },
          {
            id: 'permissions',
            label: 'Access & Permissions',
            content: accessContent,
          },
        ]}
      />

      <AdminDialog
        open={sensitiveAction !== null}
        variant="sheet"
        title={
          sensitiveAction?.kind === 'role'
            ? 'Change role'
            : sensitiveAction?.kind === 'pin'
              ? 'Reset employee PIN'
              : sensitiveAction?.kind === 'restore'
                ? 'Restore Operations access'
                : employee.active
                  ? 'Suspend employee'
                  : 'Reactivate employee'
        }
        description="Confirm this access change with your own Admin PIN."
        onOpenChange={(open) => {
          if (!open) {
            setSensitiveAction(null);
            setActorPin('');
          }
        }}
      >
        {sensitiveAction?.kind === 'role' ? (
          <label className="admin-field">
            <span>New role</span>
            <select
              value={roleDraft}
              onChange={(event) => setRoleDraft(event.target.value as AdminRole)}
            >
              <option value="OWNER">Owner</option>
              <option value="ADMIN">Administrator</option>
              <option value="MANAGER">Manager</option>
              <option value="STAFF">Staff</option>
            </select>
          </label>
        ) : null}
        {sensitiveAction?.kind === 'pin' ? (
          <label className="admin-field">
            <span>New employee PIN</span>
            <input
              inputMode="numeric"
              type="password"
              value={newPin}
              onChange={(event) => {
                setNewPin(event.target.value);
                setPinCommandId(crypto.randomUUID());
              }}
            />
          </label>
        ) : null}
        <label className="admin-field">
          <span>Confirm with your Admin PIN</span>
          <input
            aria-label="Admin PIN for staff changes"
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
            onClick={() => setSensitiveAction(null)}
          >
            Cancel
          </button>
          <button
            className={
              sensitiveAction?.kind === 'status' && employee.active
                ? 'admin-destructive-button'
                : 'admin-primary-button'
            }
            type="button"
            disabled={
              !actorPin ||
              (sensitiveAction?.kind === 'role' && roleDraft === employee.role) ||
              (sensitiveAction?.kind === 'pin' && !/^\d{4,12}$/.test(newPin))
            }
            onClick={() => {
              if (!sensitiveAction) return;
              if (sensitiveAction.kind === 'role')
                onSensitiveCommand(
                  {
                    type: 'employee.role',
                    employeeId: employee.id,
                    shopId,
                    role: roleDraft,
                    expectedVersion: employee.profileVersion,
                  },
                  actorPin,
                );
              if (sensitiveAction.kind === 'pin')
                onSensitiveCommand(
                  {
                    type: 'employee.pin',
                    employeeId: employee.id,
                    shopId,
                    newPin,
                    commandId: pinCommandId,
                  },
                  actorPin,
                );
              if (sensitiveAction.kind === 'status')
                onSensitiveCommand(
                  employee.active
                    ? {
                        type: 'employee.suspend',
                        employeeId: employee.id,
                        shopId,
                        expectedVersion: employee.profileVersion,
                      }
                    : {
                        type: 'employee.reactivate',
                        employeeId: employee.id,
                        shopId,
                        expectedVersion: employee.profileVersion,
                      },
                  actorPin,
                );
              if (sensitiveAction.kind === 'restore')
                onSensitiveCommand(
                  {
                    type: 'employee.reactivate-worker',
                    employeeId: employee.id,
                    shopId: sensitiveAction.identity.shopId,
                    workerId: sensitiveAction.identity.workerId,
                    expectedEmployeeCredentialVersion: employee.credentialVersion,
                    expectedWorkerCredentialVersion: sensitiveAction.identity.credentialVersion,
                  },
                  actorPin,
                );
              setSensitiveAction(null);
              setActorPin('');
              setNewPin('');
            }}
          >
            Confirm change
          </button>
        </div>
      </AdminDialog>
    </article>
  );
}
