import type { EmployeeDetail } from '@tux/admin-contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { EmployeeDetailPage } from './EmployeeDetailPage';

const employee: EmployeeDetail = {
  id: '11111111-1111-4111-8111-111111111111',
  businessId: '22222222-2222-4222-8222-222222222222',
  displayName: 'Mona Ali',
  phone: '+201000000000',
  hireDate: '2026-09-01',
  notes: null,
  role: 'STAFF',
  active: true,
  profileVersion: 2,
  credentialVersion: 3,
  customPermissions: [],
  assignments: [{ shopId: '33333333-3333-4333-8333-333333333333', assigned: true }],
  operationsIdentities: [
    {
      kind: 'SETUP_REQUIRED',
      shopId: '33333333-3333-4333-8333-333333333333',
    },
  ],
  compensation: [],
  shifts: [],
  attendanceEvents: [],
  attendanceCorrections: [],
  leaveRequests: [],
  payments: [],
};

describe('EmployeeDetailPage', () => {
  it('keeps schedule, attendance, pay and permissions behind explicit detail actions', () => {
    const html = renderToStaticMarkup(
      <EmployeeDetailPage
        employee={employee}
        canManage
        canPay
        financeAccounts={[]}
        workers={[]}
        onCommand={vi.fn()}
        onSensitiveCommand={vi.fn()}
      />,
    );

    for (const label of ['Schedule', 'Attendance', 'Leave', 'Pay', 'Permissions']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('Operations identity setup required');
    expect(html).not.toContain('employee score');
  });
});
