import type { EmployeeDetail } from '@tux/admin-contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { StaffMetricsPanel } from './StaffMetricsPanel';

const employee: EmployeeDetail = {
  id: '11111111-1111-4111-8111-111111111111',
  businessId: '22222222-2222-4222-8222-222222222222',
  displayName: 'Mona Ali',
  phone: null,
  hireDate: null,
  notes: null,
  role: 'STAFF',
  active: true,
  profileVersion: 1,
  credentialVersion: 1,
  customPermissions: [],
  assignments: [{ shopId: '33333333-3333-4333-8333-333333333333', assigned: true }],
  operationsIdentities: [],
  compensation: [],
  shifts: [],
  attendanceEvents: [],
  attendanceCorrections: [],
  attendanceSummaries: [
    {
      employeeId: '11111111-1111-4111-8111-111111111111',
      shopId: '33333333-3333-4333-8333-333333333333',
      scheduledShiftId: '44444444-4444-4444-8444-444444444444',
      scheduledStartsAt: '2026-09-27T06:00:00.000Z',
      scheduledEndsAt: '2026-09-27T14:00:00.000Z',
      plannedBreakMinutes: 30,
      actualStartsAt: '2026-09-27T06:15:00.000Z',
      actualEndsAt: '2026-09-27T14:20:00.000Z',
      workedMinutes: 455,
      lateMinutes: 15,
      leftEarlyMinutes: 0,
      overtimeMinutes: 5,
      absent: false,
    },
    {
      employeeId: '11111111-1111-4111-8111-111111111111',
      shopId: '33333333-3333-4333-8333-333333333333',
      scheduledShiftId: '55555555-5555-4555-8555-555555555555',
      scheduledStartsAt: '2026-09-28T06:00:00.000Z',
      scheduledEndsAt: '2026-09-28T14:00:00.000Z',
      plannedBreakMinutes: 30,
      actualStartsAt: null,
      actualEndsAt: null,
      workedMinutes: 0,
      lateMinutes: 0,
      leftEarlyMinutes: 0,
      overtimeMinutes: 0,
      absent: true,
    },
  ],
  leaveRequests: [],
  payments: [],
};

describe('StaffMetricsPanel', () => {
  it('shows factual attendance totals without scoring or ranking employees', () => {
    const html = renderToStaticMarkup(<StaffMetricsPanel employee={employee} />);

    expect(html).toContain('Worked');
    expect(html).toContain('7h 35m');
    expect(html).toContain('Overtime');
    expect(html).toContain('5m');
    expect(html).toContain('Late shifts');
    expect(html).toContain('Absent shifts');
    expect(html).not.toContain('score');
    expect(html).not.toContain('rank');
  });
});
