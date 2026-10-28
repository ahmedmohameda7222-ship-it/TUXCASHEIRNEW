import type { EmployeeSummary } from '@tux/admin-contracts';

import type { AdminSummaryMetric } from '../components/layout/AdminMetricStrip';

/**
 * Staff workspace rows are cursor-paginated. A rendered page is not a
 * shop-wide total unless the API returned no next cursor.
 *
 * Directory state is shop-scoped. Never fabricate leave aggregates from
 * a single employee detail when no authoritative shop-wide count exists.
 */
export function staffSummaryMetrics(
  employees: readonly Pick<EmployeeSummary, 'active' | 'operationsSetupRequiredShopIds'>[],
  selectedShopId: string,
  complete: boolean,
): readonly AdminSummaryMetric[] {
  const total = complete ? employees.length : null;
  const active = complete ? employees.filter((employee) => employee.active).length : null;
  const suspended = complete ? employees.filter((employee) => !employee.active).length : null;
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
    { id: 'suspended', label: 'Suspended staff', value: suspended },
  ];
}
