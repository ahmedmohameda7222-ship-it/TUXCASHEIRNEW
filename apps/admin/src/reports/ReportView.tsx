import type { ReactNode } from 'react';
import { Link } from 'wouter';
import type { ReportDrilldown } from '@tux/admin-contracts';

import { EmptyState, ErrorState, LoadingState } from '../components/feedback/AdminStates';
import { formatEgp } from '../finance/money';

import type { ReportFilters, ReportResponse } from './useReports';
import { REPORT_LABELS } from './reportLabels';
import { completeReportDailyActivity } from './reportTrend';

function amountLabel(amount: number | null): string {
  return amount === null ? 'Cost data incomplete' : formatEgp(amount);
}
/** Pagination is truthful even when a filtered report has no rows. */
export function reportPaginationLabel(offset: number, rowCount: number, total: number): string {
  if (total === 0) return '0 results';
  if (rowCount === 0) return 'No rows on this page';
  return `Showing ${offset + 1}–${offset + rowCount} of ${total}`;
}

export function reportDrilldownHref(target: ReportDrilldown | null): string | null {
  if (!target) return null;
  switch (target.type) {
    case 'ORDER':
      return `/orders/${encodeURIComponent(target.orderId)}`;
    case 'PURCHASE_ORDER':
      return `/purchasing/${encodeURIComponent(target.purchaseOrderId)}`;
    case 'CUSTOMER':
      return `/customers/${encodeURIComponent(target.customerId)}`;
    case 'STAFF':
      return `/staff/${encodeURIComponent(target.employeeId)}${target.section ? `?section=${encodeURIComponent(target.section)}` : ''}`;
    case 'INVENTORY_ITEM':
      return `/inventory/${encodeURIComponent(target.inventoryItemId)}`;
    case 'FINANCE_ACCOUNT':
      return `/finance/${encodeURIComponent(target.accountId)}${target.movementId ? `?movementId=${encodeURIComponent(target.movementId)}` : ''}`;
    case 'FINANCIAL_DAY':
      return `/finance/end-day?businessDayId=${encodeURIComponent(target.businessDayId)}`;
    case 'EXPENSE':
      return `/finance/expenses?expenseId=${encodeURIComponent(target.expenseId)}`;
    default:
      return null;
  }
}
export function ReportView({
  data,
  filters,
  onOffset,
  loading,
  error,
  retry,
  exportActions,
}: {
  data: ReportResponse | undefined;
  filters: ReportFilters;
  onOffset(next: number): void;
  loading: boolean;
  error: boolean;
  retry(): void;
  exportActions?: ReactNode;
}) {
  if (loading)
    return <LoadingState title="Building report" description="Reading canonical data…" />;
  if (error)
    return (
      <ErrorState
        title="Report unavailable"
        action={
          <button className="admin-secondary-button" type="button" onClick={retry}>
            Retry
          </button>
        }
      />
    );
  if (!data) return null;
  const summary = data.summary;
  const activity = completeReportDailyActivity(data, filters);
  const peak = Math.max(1, ...(activity?.map((day) => day.count) ?? []));
  return (
    <section className="tux-report-view" aria-label="Report results">
      <header className="tux-report-view__intro">
        <div className="tux-report-view__title">
          <h2>{REPORT_LABELS[data.area]}</h2>
        <p>
          {filters.fromDate} – {filters.toDate} · {filters.shopIds.length}{' '}
          {filters.shopIds.length === 1 ? 'shop' : 'shops'} ·{' '}
          {filters.source === 'POS'
            ? 'POS only'
            : filters.source === 'ONLINE'
              ? 'Online only'
              : 'All sources'}
        </p>
        </div>
        {exportActions}
      </header>
      <div className="tux-report-metrics">
        <div>
          <small>Recorded amount</small>
          <strong>{amountLabel(summary.totalAmountMinor)}</strong>
        </div>
        <div>
          <small>Source events</small>
          <strong>{summary.eventCount.toLocaleString('en-EG')}</strong>
        </div>
        <div>
          <small>Total quantity</small>
          <strong>{summary.totalQuantity.toLocaleString('en-EG')}</strong>
        </div>
        {data.comparison ? (
          <div>
            <small>Previous period recorded amount</small>
            <strong>{amountLabel(data.comparison.summary.totalAmountMinor)}</strong>
          </div>
        ) : null}
      </div>
      <section className="tux-report-trend" aria-label="Activity over time">
        <div className="tux-report-trend__header">
          <div>
            <h3>Activity over time</h3>
            <small>Based on complete matching source events in the Cairo calendar</small>
          </div>
        </div>
        {activity ? (
          <div
            className="tux-report-trend__bars"
            role="img"
            aria-label={activity.map((day) => `${day.date}: ${day.count} events`).join(', ')}
          >
            {activity.map((day) => (
              <div key={day.date} className="tux-report-trend__day">
                <div
                  className="tux-report-trend__bar"
                  style={{ height: `${Math.max(2, (day.count / peak) * 100)}%` }}
                />
                <small>{day.date.slice(5)}</small>
              </div>
            ))}
          </div>
        ) : (
          <p className="tux-report-trend__unavailable">
            Trend unavailable: the loaded source page is not the complete date-range dataset.
          </p>
        )}
      </section>
      {summary.incompleteCostEvents > 0 ? (
        <p role="status" className="tux-report-caveat">
          {summary.incompleteCostEvents} source event(s) lack a verified unit cost. An incomplete
          cost total is never presented as profit.
        </p>
      ) : null}
      {summary.coverageNote ? <p className="tux-report-caveat">{summary.coverageNote}</p> : null}
      <header className="tux-report-results__heading">
        <h3>Source activity</h3>
        <small>{summary.eventCount.toLocaleString('en-EG')} matching records</small>
      </header>
      {data.rows.length === 0 ? (
        <EmptyState
          title="No report events"
          description="There are no matching records for this shop and date range."
        />
      ) : (
        <div className="tux-report-results">
          <ul className="tux-report-mobile-entries" aria-label="Report entries">
            {data.rows.map((fact) => {
              const href = reportDrilldownHref(fact.drilldown);
              return (
                <li key={`mobile:${fact.sourceKind}:${fact.id}`}>
                  <div className="tux-report-mobile-entries__top">
                    <span>
                      {new Date(fact.occurredAt).toLocaleDateString('en-EG', {
                        timeZone: 'Africa/Cairo',
                      })}
                    </span>
                    <strong>
                      {fact.amountMinor === null ? 'Not available' : amountLabel(fact.amountMinor)}
                    </strong>
                  </div>
                  <small>{fact.sourceKind.replaceAll('-', ' ')}</small>
                  <p>{href ? <Link href={href}>{fact.label}</Link> : fact.label}</p>
                </li>
              );
            })}
          </ul>
          <div className="tux-report-table-wrap">
            <table className="tux-report-table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Source</th>
                  <th scope="col">Description</th>
                  <th scope="col">Amount (EGP)</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((fact) => {
                  const href = reportDrilldownHref(fact.drilldown);
                  return (
                    <tr key={`${fact.sourceKind}:${fact.id}`}>
                      <td>
                        {new Date(fact.occurredAt).toLocaleDateString('en-EG', {
                          timeZone: 'Africa/Cairo',
                        })}
                      </td>
                      <td>{fact.sourceKind.replaceAll('-', ' ')}</td>
                      <td>{href ? <Link href={href}>{fact.label}</Link> : fact.label}</td>
                      <td>
                        {fact.amountMinor === null
                          ? 'Not available'
                          : amountLabel(fact.amountMinor)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <nav className="tux-report-pagination" aria-label="Report pages">
        <button
          type="button"
          className="admin-secondary-button"
          disabled={filters.offset === 0}
          onClick={() => onOffset(Math.max(0, filters.offset - 50))}
        >
          Previous
        </button>
        <span>{reportPaginationLabel(filters.offset, data.rows.length, summary.eventCount)}</span>
        <button
          type="button"
          className="admin-secondary-button"
          disabled={data.nextOffset === null}
          onClick={() => onOffset(data.nextOffset ?? filters.offset)}
        >
          Next
        </button>
      </nav>
    </section>
  );
}
