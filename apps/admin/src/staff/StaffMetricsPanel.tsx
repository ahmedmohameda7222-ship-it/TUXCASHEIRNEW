import type { EmployeeDetail } from '@tux/admin-contracts';

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

  return (
    <section aria-label="Staff factual metrics">
      <h3>Activity facts</h3>
      <div className="admin-more-grid">
        <div className="admin-more-card">
          <strong>{workedMinutes}</strong>
          <span>Worked minutes</span>
        </div>
        <div className="admin-more-card">
          <strong>{overtimeMinutes}</strong>
          <span>Overtime minutes</span>
        </div>
        <div className="admin-more-card">
          <strong>{lateShifts}</strong>
          <span>Late shifts</span>
        </div>
        <div className="admin-more-card">
          <strong>{absentShifts}</strong>
          <span>Absent shifts</span>
        </div>
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
