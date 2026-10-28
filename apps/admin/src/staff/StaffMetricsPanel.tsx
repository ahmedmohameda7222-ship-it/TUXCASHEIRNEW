import type { EmployeeDetail } from '@tux/admin-contracts';

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours > 0 ? `${hours}h ${remainder}m` : `${remainder}m`;
}

export function StaffMetricsPanel({ employee }: { employee: EmployeeDetail }) {
  const scheduledShifts = employee.shifts.filter((shift) => shift.status === 'SCHEDULED').length;
  const attendanceSessions = new Set(
    employee.attendanceEvents.map((event) => event.workerSessionId),
  ).size;
  const approvedLeave = employee.leaveRequests.filter(
    (request) => request.status === 'APPROVED',
  ).length;
  const workedMinutes = employee.attendanceSummaries.reduce(
    (total, summary) => total + summary.workedMinutes,
    0,
  );
  const overtimeMinutes = employee.attendanceSummaries.reduce(
    (total, summary) => total + summary.overtimeMinutes,
    0,
  );
  const lateShifts = employee.attendanceSummaries.filter(
    (summary) => summary.lateMinutes > 0,
  ).length;
  const absentShifts = employee.attendanceSummaries.filter((summary) => summary.absent).length;

  const primaryFacts = [
    ['Shifts', scheduledShifts],
    ['Clock events', employee.attendanceEvents.length],
    ['Corrections', employee.attendanceCorrections.length],
    ['Approved leave', approvedLeave],
    ['Payments', employee.payments.length],
    [
      'Overrides',
      employee.customPermissions.length + (employee.customDeniedPermissions?.length ?? 0),
    ],
  ] as const;

  return (
    <section className="admin-staff-section admin-staff-facts" aria-label="Staff factual metrics">
      <h3>Activity facts</h3>
      <div className="admin-staff-activity-grid">
        {primaryFacts.map(([label, value]) => (
          <div className="admin-staff-activity-fact" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <details className="admin-staff-extra-facts">
        <summary>More attendance facts</summary>
        <div className="admin-staff-activity-grid">
          <div className="admin-staff-activity-fact">
            <span>Worked</span>
            <strong>{formatDuration(workedMinutes)}</strong>
          </div>
          <div className="admin-staff-activity-fact">
            <span>Overtime</span>
            <strong>{formatDuration(overtimeMinutes)}</strong>
          </div>
          <div className="admin-staff-activity-fact">
            <span>Late shifts</span>
            <strong>{lateShifts}</strong>
          </div>
          <div className="admin-staff-activity-fact">
            <span>Absent shifts</span>
            <strong>{absentShifts}</strong>
          </div>
          <div className="admin-staff-activity-fact">
            <span>Attendance sessions</span>
            <strong>{attendanceSessions}</strong>
          </div>
        </div>
      </details>
    </section>
  );
}
