import type { AdminReportArea } from '@tux/admin-contracts';
import type { ReportFilters } from './useReports';

/** A report-area change invalidates area-specific filters and the old page offset. */
export function chooseReportArea(filters: ReportFilters, area: AdminReportArea): ReportFilters {
  if (area === filters.area) return filters;
  return {
    ...filters,
    area,
    source: null,
    context: {},
    offset: 0,
  };
}
