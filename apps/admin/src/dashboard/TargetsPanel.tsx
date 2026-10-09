import { formatEgp } from '../finance/money';
import type { ReportFilters, ReportSummary, ReportTargetRow } from '../reports/useReports';

function targetLabel(metric: ReportTargetRow['metric']): string {
  return {
    NET_SALES: 'Net sales',
    ORDER_COUNT: 'Orders',
    FOOD_COST_PERCENT: 'Food cost %',
    WASTE: 'Waste cost',
  }[metric];
}
function targetAmount(metric: ReportTargetRow['metric'], value: number): string {
  if (metric === 'NET_SALES' || metric === 'WASTE') return formatEgp(value);
  if (metric === 'FOOD_COST_PERCENT') return (value / 100).toLocaleString('en-EG') + '%';
  return String(value);
}
export function TargetsPanel({
  targets,
  filters,
  summary,
}: {
  targets: readonly ReportTargetRow[];
  filters: ReportFilters;
  summary: ReportSummary | undefined;
}) {
  if (targets.length === 0) return null;
  return (
    <section className="tux-targets-panel" aria-label="Shop targets">
      <h2>Shop targets</h2>
      <ul className="tux-reports-saved">
        {targets.map((target) => {
          const isMatchingRange =
            target.periodStart === filters.fromDate && target.periodEnd === filters.toDate;
          const canCompare =
            summary &&
            isMatchingRange &&
            ((target.metric === 'NET_SALES' && filters.area === 'sales') ||
              (target.metric === 'ORDER_COUNT' && filters.area === 'sales'));
          const actual =
            target.metric === 'NET_SALES'
              ? summary?.totalAmountMinor
              : target.metric === 'ORDER_COUNT'
                ? summary?.orderCount
                : null;
          const display =
            canCompare && typeof actual === 'number'
              ? ` · Recorded ${targetAmount(target.metric, actual)}`
              : '';
          return (
            <li key={target.id}>
              <span>
                {targetLabel(target.metric)} · {target.periodStart}–{target.periodEnd}
              </span>
              <strong>
                {targetAmount(target.metric, target.targetValue)}
                {display}
              </strong>
            </li>
          );
        })}
      </ul>
      <p className="tux-finance-muted">
        Progress is shown only when the selected reporting metric and dates match the target.
      </p>
    </section>
  );
}
