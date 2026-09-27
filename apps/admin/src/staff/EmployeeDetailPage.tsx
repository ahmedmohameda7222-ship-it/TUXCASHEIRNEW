import type {
  EmployeeDetail,
  StaffFinanceAccountChoice,
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
  onCommand,
}: {
  employee: EmployeeDetail;
  shopId?: string;
  canManage: boolean;
  canPay: boolean;
  financeAccounts: readonly StaffFinanceAccountChoice[];
  onCommand(command: StaffCommandDraft): void;
}) {
  const [tab, setTab] = useState<DetailTab>('profile');
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

      <nav className="admin-catalog-editor__section is-compact" aria-label="Employee detail sections">
        {([
          ['profile', 'Profile'],
          ['schedule', 'Schedule'],
          ['attendance', 'Attendance'],
          ['leave', 'Leave'],
          ['pay', 'Pay'],
          ['permissions', 'Permissions'],
        ] as const).map(([value, label]) => (
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
              <dd>{employee.assignments.map((assignment) => assignment.shopId).join(', ') || 'None'}</dd>
              <dt>Credential version</dt>
              <dd>{employee.credentialVersion}</dd>
            </dl>
            {setupRequired.length > 0 ? (
              <div className="admin-empty-state">
                <strong>Operations identity setup required</strong>
                <span>
                  Missing linked worker identity for {setupRequired.length} assigned shop
                  {setupRequired.length === 1 ? '' : 's'}.
                </span>
              </div>
            ) : (
              <p>Operations identity linked for every assigned shop.</p>
            )}
          </section>
          <StaffMetricsPanel employee={employee} />
          {canManage ? (
            <section className="admin-catalog-editor__section is-compact">
              <h3>Access status</h3>
              <button
                className="admin-secondary-button"
                type="button"
                onClick={() =>
                  onCommand({
                    type: employee.active ? 'employee.suspend' : 'employee.reactivate',
                    employeeId: employee.id,
                    shopId,
                    expectedVersion: employee.profileVersion,
                  })
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
        />
      ) : null}
      {tab === 'permissions' ? (
        <PermissionsEditor
          employee={employee}
          shopId={shopId}
          canManage={canManage}
          onCommand={onCommand}
        />
      ) : null}
    </article>
  );
}
