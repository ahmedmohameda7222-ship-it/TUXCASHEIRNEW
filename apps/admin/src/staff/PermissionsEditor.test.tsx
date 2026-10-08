import type { EmployeeDetail } from '@tux/admin-contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PermissionsEditor } from './PermissionsEditor';

const employee = {
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
  customPermissions: ['staff.manage'],
  customDeniedPermissions: [],
  assignments: [],
  operationsIdentities: [],
  compensation: [],
  shifts: [],
  attendanceEvents: [],
  attendanceCorrections: [],
  attendanceSummaries: [],
  leaveRequests: [],
  payments: [],
} satisfies EmployeeDetail;

describe('PermissionsEditor', () => {
  it('offers restoring an explicit override to inherited role behavior', () => {
    const html = renderToStaticMarkup(
      <PermissionsEditor
        employee={employee}
        shopId="11111111-1111-4111-8111-111111111111"
        canManage
        onSensitiveCommand={() => undefined}
      />,
    );
    expect(html).toContain('Access &amp; Permissions');
    expect(html).toContain('Role default');
    expect(html).toContain('Allowed');
    expect(html).toContain('Not allowed');
    expect(html).not.toContain('staff.manage');
  });
});
