import type { EmployeeDetail, StaffWorkerChoice } from '@tux/admin-contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { EmployeeDetailPage } from './EmployeeDetailPage';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_SHOP_ID = '77777777-7777-4777-8777-777777777777';
const WORKER_ID = '33333333-3333-4333-8333-333333333333';

function employee(overrides: Partial<EmployeeDetail> = {}): EmployeeDetail {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    businessId: '55555555-5555-4555-8555-555555555555',
    displayName: 'Mona Ali',
    phone: null,
    hireDate: null,
    notes: null,
    role: 'STAFF',
    active: true,
    profileVersion: 2,
    credentialVersion: 3,
    customPermissions: [],
    customDeniedPermissions: [],
    assignments: [{ shopId: SHOP_ID, assigned: true }],
    operationsIdentities: [{ kind: 'SETUP_REQUIRED', shopId: SHOP_ID }],
    compensation: [],
    shifts: [],
    attendanceEvents: [],
    attendanceCorrections: [],
    attendanceSummaries: [],
    leaveRequests: [],
    payments: [],
    ...overrides,
  };
}

function render(
  detail: EmployeeDetail,
  canManage = true,
  workers: readonly StaffWorkerChoice[] = [],
  section: 'profile' | 'attendance' | 'pay' = 'profile',
) {
  return renderToStaticMarkup(
    <EmployeeDetailPage
      employee={detail}
      section={section}
      onSectionChange={() => undefined}
      shopId={SHOP_ID}
      canManage={canManage}
      canPay
      financeAccounts={[]}
      workers={workers}
      shops={[
        { id: SHOP_ID, name: 'Current shop' },
        { id: OTHER_SHOP_ID, name: 'Other shop' },
      ]}
      onCommand={() => undefined}
      onSensitiveCommand={() => undefined}
    />,
  );
}

describe('EmployeeDetailPage', () => {
  it('keeps Profile focused and moves access work into its own tab', () => {
    const html = render(employee());
    expect(html).toContain('Mona Ali');
    expect(html).toContain('Current shop');
    expect(html).toContain('Access &amp; Permissions');
    expect(html).not.toContain('Operations setup required');
    expect(html).not.toContain(SHOP_ID);
  });

  it('renders an inactive preserved link as disabled rather than healthy setup', () => {
    const html = render(
      employee({
        operationsIdentities: [
          {
            kind: 'LINKED',
            shopId: SHOP_ID,
            workerId: WORKER_ID,
            workerName: 'Mona Ops',
            workerActive: false,
            credentialVersion: 8,
          },
        ],
      }),
    );
    expect(html).toContain('Access &amp; Permissions');
    expect(html).not.toContain('Operations access disabled');
    expect(html).not.toContain('Operations access: Ready');
  });

  it('does not offer Operations reactivation to a viewer without staff.manage', () => {
    const html = render(
      employee({
        operationsIdentities: [
          {
            kind: 'LINKED',
            shopId: SHOP_ID,
            workerId: WORKER_ID,
            workerName: 'Mona Ops',
            workerActive: false,
            credentialVersion: 8,
          },
        ],
      }),
      false,
    );
    expect(html).toContain('Access &amp; Permissions');
    expect(html).not.toContain('Restore Operations access');
  });

  it('does not submit current-shop setup when only another shop is missing Operations access', () => {
    const html = render(
      employee({
        assignments: [
          { shopId: SHOP_ID, assigned: true },
          { shopId: OTHER_SHOP_ID, assigned: true },
        ],
        operationsIdentities: [
          {
            kind: 'LINKED',
            shopId: SHOP_ID,
            workerId: WORKER_ID,
            workerName: 'Mona Ops',
            workerActive: true,
            credentialVersion: 8,
          },
          { kind: 'SETUP_REQUIRED', shopId: OTHER_SHOP_ID },
        ],
      }),
      true,
      [
        {
          id: '99999999-9999-4999-8999-999999999999',
          shopId: SHOP_ID,
          displayName: 'Available current-shop worker',
          linkedEmployeeId: null,
        },
      ],
    );

    expect(html).toContain('Other shop');
    expect(html).toContain('Access &amp; Permissions');
    expect(html).not.toContain('Complete Operations setup');
  });
  it('displays the URL-selected Attendance and Pay tab for an exact employee', () => {
    const attendance = render(employee(), true, [], 'attendance');
    const pay = render(employee(), true, [], 'pay');
    expect(attendance).toMatch(/role="tab" aria-selected="true"[^>]*>Attendance<\\/button>/);
    expect(pay).toMatch(/role="tab" aria-selected="true"[^>]*>Pay \\/ Compensation<\\/button>/);
    expect(attendance).toContain('role="tabpanel"');
    expect(pay).toContain('role="tabpanel"');
  });

});
