import type {
  AdminRole,
  EmployeeDetail,
  StaffFinanceAccountChoice,
  StaffWorkerChoice,
} from '@tux/admin-contracts';
import { useState } from 'react';

import { AttendancePage } from './AttendancePage';
import { LeavePage } from './LeavePage';
import { PermissionsEditor } from './PermissionsEditor';
import { SchedulePage, type StaffCommandDraft } from './SchedulePage';
import { StaffMetricsPanel } from './StaffMetricsPanel';
import { StaffPaymentPage } from './StaffPaymentPage';

type DetailTab = 'profile' | 'schedule' | 'attendance' | 'leave' | 'pay' | 'permissions';

export function EmployeeDetailPage({
  employee,
  shopId = employee.assignments[0]?.shopId ?? '',
  canManage,
  canPay,
  financeAccounts,
  workers,
  availableShopIds,
  onCommand,
  onSensitiveCommand,
}: {
  employee: EmployeeDetail;
  shopId?: string;
  canManage: boolean;
  canPay: boolean;
  financeAccounts: readonly StaffFinanceAccountChoice[];
  workers: readonly StaffWorkerChoice[];
  availableShopIds: readonly string[];
  onCommand(command: StaffCommandDraft): void;
  onSensitiveCommand(command: StaffCommandDraft, pin: string): void;
}) {
  const [tab, setTab] = useState<DetailTab>('profile');
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
  const unassignedShopIds = availableShopIds.filter(
    (candidate) => !employee.assignments.some((assignment) => assignment.shopId === candidate),
  );
  const [assignShopId, setAssignShopId] = useState(unassignedShopIds[0] ?? '');
  const setupRequired = employee.operationsIdentities.filter(
    (identity) => identity.kind === 'SETUP_REQUIRED',
  );

  return (
    <article aria-label={`Employee ${employee.displayName}`}>
      <header className="admin-page__header">
        <div>
          <p className="admin-page__eyebrow">Staff profile</p>
          <h2>{employee.displayName}</h2>
          <p className="admin-page__description">
            {employee.role} · {employee.active ? 'Active' : 'Suspended'}
          </p>
        </div>
      </header>

      <nav
        className="admin-catalog-editor__section is-compact"
        aria-label="Employee detail sections"
      >
        {(
          [
            ['profile', 'Profile'],
            ['schedule', 'Schedule'],
            ['attendance', 'Attendance'],
            ['leave', 'Leave'],
            ['pay', 'Pay'],
            ['permissions', 'Permissions'],
          ] as const
        ).map(([value, label]) => (
          <button
            className={tab === value ? 'admin-primary-button' : 'admin-secondary-button'}
            key={value}
            type="button"
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'profile' ? (
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
                {employee.assignments.map((assignment) => assignment.shopId).join(', ') || 'None'}
              </dd>
              <dt>Credential version</dt>
              <dd>{employee.credentialVersion}</dd>
            </dl>
            {canManage ? (
              <section className="admin-catalog-editor__section is-compact">
                <h4>Edit profile</h4>
                <label className="admin-field">
                  <span>Name</span>
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                  />
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
                        {candidate}
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

            {canManage ? (
              <section className="admin-catalog-editor__section is-compact">
                <h4>Compensation</h4>
                {latestCompensation ? (
                  <p>
                    Current: {latestCompensation.compensationType} ·{' '}
                    {(latestCompensation.rateMinor / 100).toFixed(2)} EGP · effective{' '}
                    {latestCompensation.effectiveFrom}
                  </p>
                ) : (
                  <p>No compensation record yet.</p>
                )}
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
              </section>
            ) : null}

            {setupRequired.length > 0 ? (
              <div className="admin-empty-state">
                <strong>Operations identity setup required</strong>
                <span>
                  Missing linked worker identity for {setupRequired.length} assigned shop
                  {setupRequired.length === 1 ? '' : 's'}.
                </span>
                {canManage && availableWorkers.length > 0 ? (
                  <>
                    <label className="admin-field">
                      <span>Operations worker</span>
                      <select
                        value={workerId}
                        onChange={(event) => setWorkerId(event.target.value)}
                      >
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
                      Link Operations identity
                    </button>
                  </>
                ) : canManage ? (
                  <span>No unlinked active Operations worker is available for this shop.</span>
                ) : null}
              </div>
            ) : (
              <p>Operations identity linked for every assigned shop.</p>
            )}
          </section>
          <StaffMetricsPanel employee={employee} />
          {canManage ? (
            <section className="admin-catalog-editor__section is-compact">
              <h3>Sensitive access actions</h3>
              <label className="admin-field">
                <span>Your Admin PIN</span>
                <input
                  aria-label="Admin PIN for staff changes"
                  inputMode="numeric"
                  type="password"
                  value={actorPin}
                  onChange={(event) => setActorPin(event.target.value)}
                />
              </label>

              <label className="admin-field">
                <span>Role</span>
                <select
                  value={roleDraft}
                  onChange={(event) => setRoleDraft(event.target.value as AdminRole)}
                >
                  <option value="OWNER">OWNER</option>
                  <option value="ADMIN">ADMIN</option>
                  <option value="MANAGER">MANAGER</option>
                  <option value="STAFF">STAFF</option>
                </select>
              </label>
              <button
                className="admin-secondary-button"
                type="button"
                disabled={!actorPin || roleDraft === employee.role}
                onClick={() =>
                  onSensitiveCommand(
                    {
                      type: 'employee.role',
                      employeeId: employee.id,
                      shopId,
                      role: roleDraft,
                      expectedVersion: employee.profileVersion,
                    },
                    actorPin,
                  )
                }
              >
                Change role
              </button>

              <label className="admin-field">
                <span>New employee PIN</span>
                <input
                  aria-label="New employee PIN"
                  inputMode="numeric"
                  type="password"
                  value={newPin}
                  onChange={(event) => {
                    setNewPin(event.target.value);
                    setPinCommandId(crypto.randomUUID());
                  }}
                />
              </label>
              <button
                className="admin-secondary-button"
                type="button"
                disabled={!actorPin || !/^\d{4,12}$/.test(newPin)}
                onClick={() =>
                  onSensitiveCommand(
                    {
                      type: 'employee.pin',
                      employeeId: employee.id,
                      shopId,
                      newPin,
                      commandId: pinCommandId,
                    },
                    actorPin,
                  )
                }
              >
                Reset PIN
              </button>

              <button
                className="admin-secondary-button"
                type="button"
                disabled={!actorPin}
                onClick={() =>
                  employee.active
                    ? onSensitiveCommand(
                        {
                          type: 'employee.suspend',
                          employeeId: employee.id,
                          shopId,
                          expectedVersion: employee.profileVersion,
                        },
                        actorPin,
                      )
                    : onSensitiveCommand(
                        {
                          type: 'employee.reactivate',
                          employeeId: employee.id,
                          shopId,
                          expectedVersion: employee.profileVersion,
                        },
                        actorPin,
                      )
                }
              >
                {employee.active ? 'Suspend employee' : 'Reactivate employee'}
              </button>
            </section>
          ) : null}
        </>
      ) : null}

      {tab === 'schedule' ? (
        <SchedulePage
          employee={employee}
          shopId={shopId}
          canManage={canManage}
          onCommand={onCommand}
        />
      ) : null}
      {tab === 'attendance' ? (
        <AttendancePage
          employee={employee}
          shopId={shopId}
          canManage={canManage}
          onCommand={onCommand}
        />
      ) : null}
      {tab === 'leave' ? (
        <LeavePage
          employee={employee}
          shopId={shopId}
          canManage={canManage}
          onCommand={onCommand}
        />
      ) : null}
      {tab === 'pay' ? (
        <StaffPaymentPage
          employee={employee}
          shopId={shopId}
          accounts={financeAccounts}
          canPay={canPay}
          onCommand={onCommand}
          onSensitiveCommand={onSensitiveCommand}
        />
      ) : null}
      {tab === 'permissions' ? (
        <PermissionsEditor
          employee={employee}
          shopId={shopId}
          canManage={canManage}
          actorPin={actorPin}
          onSensitiveCommand={onSensitiveCommand}
        />
      ) : null}
    </article>
  );
}
