import type { EmployeeSummary } from '@tux/admin-contracts';

import type { AdminSummaryMetric } from '../components/layout/AdminMetricStrip';

/**
 * Staff workspace rows are cursor-paginated. A rendered page is not a
 * shop-wide total unless the API returned no next cursor.
 *
 * Leave approvals are not provided in the directory projection; do not
 * fabricate a summary by counting detail records for only one employee.
 */
export function staffSummaryMetrics(
  employees: readonly Pick<EmployeeSummary, 'active' | 'operationsSetupRequiredShopIds'>[],
  selectedShopId: string,
  complete: boolean,
): readonly AdminSummaryMetric[] {
  const total = complete ? employees.length : null;
  const active = complete ? employees.filter((employee) => employee.active).length : null;
  const unconfigured = complete
    ? employees.filter((employee) =>
        employee.operationsSetupRequiredShopIds.includes(selectedShopId),
      ).length
    : null;

  return [
    { id: 'employees', label: 'Employees', value: total },
    { id: 'active', label: 'Active staff', value: active },
    {
      id: 'readiness',
      label: 'Setup required',
      value: unconfigured,
      tone: unconfigured !== null && unconfigured > 0 ? 'warning' : 'default',
    },
    { id: 'leave', label: 'Pending leave', value: null, hint: 'Not provided by the directory' },
  ];
}
