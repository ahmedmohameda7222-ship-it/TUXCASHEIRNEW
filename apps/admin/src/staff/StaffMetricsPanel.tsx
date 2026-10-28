import type { EmployeeDetail } from '@tux/admin-contracts';

export function StaffMetricsPanel({ employee }: { employee: EmployeeDetail }) {
  const scheduledShifts = employee.shifts.filter((shift) => shift.status === 'SCHEDULED').length;
  const approvedLeave = employee.leaveRequests.filter(
    (request) => request.status === 'APPROVED',
  ).length;
  const metrics = [
    { label: 'Shifts', value: scheduledShifts },
    { label: 'Clock events', value: employee.attendanceEvents.length },
    { label: 'Corrections', value: employee.attendanceCorrections.length },
    { label: 'Approved leave', value: approvedLeave },
    { label: 'Payments', value: employee.payments.length },
    {
      label: 'Overrides',
      value: employee.customPermissions.length + (employee.customDeniedPermissions?.length ?? 0),
    },
  ];

  return (
    <section aria-label="Staff factual metrics">
      <h3>Activity facts</h3>
      <div className="admin-more-grid">
        {metrics.map((metric) => (
          <div className="admin-more-card" key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}
