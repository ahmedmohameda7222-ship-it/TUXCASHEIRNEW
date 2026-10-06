import type { EmployeeDetail } from '@tux/admin-contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { EmployeeDetailPage } from './EmployeeDetailPage';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
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

function render(detail: EmployeeDetail, canManage = true) {
  return renderToStaticMarkup(
    <EmployeeDetailPage
      employee={detail}
      shopId={SHOP_ID}
      canManage={canManage}
      canPay
      financeAccounts={[]}
      workers={[]}
      shops={[{ id: SHOP_ID, name: 'Current shop' }]}
      onCommand={() => undefined}
      onSensitiveCommand={() => undefined}
    />,
  );
}

describe('EmployeeDetailPage', () => {
  it('shows profile facts and Operations setup guidance without exposing shop IDs', () => {
    const html = render(employee());
    expect(html).toContain('Mona Ali');
    expect(html).toContain('Operations setup required');
    expect(html).toContain('Current shop');
    expect(html).toContain('No unlinked active Operations worker is available for this shop.');
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
    expect(html).toContain('Operations access disabled');
    expect(html).toContain('Restore Operations access');
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
    expect(html).toContain('Operations access disabled');
    expect(html).not.toContain('Restore Operations access');
  });
});
