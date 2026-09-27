import type { EmployeeDetail } from '@tux/admin-contracts';

export function StaffMetricsPanel({ employee }: { employee: EmployeeDetail }) {
  const scheduledShifts = employee.shifts.filter((shift) => shift.status === 'SCHEDULED').length;
  const attendanceSessions = new Set(
    employee.attendanceEvents.map((event) => event.workerSessionId),
  ).size;
  const approvedLeave = employee.leaveRequests.filter(
    (request) => request.status === 'APPROVED',
  ).length;

  return (
    <section aria-label="Staff factual metrics">
      <h3>Activity facts</h3>
      <div className="admin-more-grid">
        <div className="admin-more-card">
          <strong>{scheduledShifts}</strong>
          <span>Scheduled shifts</span>
        </div>
        <div className="admin-more-card">
          <strong>{attendanceSessions}</strong>
          <span>Attendance sessions</span>
        </div>
        <div className="admin-more-card">
          <strong>{employee.attendanceCorrections.length}</strong>
          <span>Attendance corrections</span>
        </div>
        <div className="admin-more-card">
          <strong>{approvedLeave}</strong>
          <span>Approved leave requests</span>
        </div>
        <div className="admin-more-card">
          <strong>{employee.payments.length}</strong>
          <span>Recorded staff payments</span>
        </div>
      </div>
    </section>
  );
}
