import { Link } from 'wouter';

import { EmptyState, ErrorState, LoadingState } from '../components/feedback/AdminStates';
import { formatEgp } from '../finance/money';

import type { ReportFilters, ReportResponse } from './useReports';

function amountLabel(amount: number | null): string {
  return amount === null ? 'Cost data incomplete' : formatEgp(amount);
}
function sourceLink(kind: string, id: string): string | null {
  if (['customer-order', 'delivery-order', 'tax-service'].includes(kind)) {
    return `/orders/${id}`;
  }
  if (kind === 'financial-z') return '/finance/end-day';
  if (kind === 'staff-payment') return '/staff';
  if (kind === 'expense') return '/finance/expenses';
  if (kind === 'finance-movement') return '/finance';
  if (kind === 'payment') return '/finance';
  if (kind === 'purchase-order') return `/purchasing/${id}`;
  if (kind === 'attendance-event') return '/staff';
  if (kind === 'inventory-movement') return '/inventory';
  if (kind === 'order-item') return '/catalog/products';
  if (kind === 'loyalty-event' || kind === 'promotion-use' || kind === 'customer-segment')
    return '/customers';
  if (kind === 'return' || kind === 'refund') return '/orders';
  if (kind === 'bank-fee') return '/finance/settlements';
  return null;
}
export function ReportView({
  data,
  filters,
  onOffset,
  loading,
  error,
  retry,
}: {
  data: ReportResponse | undefined;
  filters: ReportFilters;
  onOffset(next: number): void;
  loading: boolean;
  error: boolean;
  retry(): void;
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
  return (
    <section className="tux-report-view" aria-label="Report results">
      <div className="tux-report-metrics">
        <div>
          <small>Recorded amount</small>
          <strong>{amountLabel(summary.totalAmountMinor)}</strong>
        </div>
        <div>
          <small>Source events</small>
          <strong>{summary.eventCount.toLocaleString('en-EG')}</strong>
        </div>
        {data.comparison ? (
          <div>
            <small>Previous period recorded amount</small>
            <strong>{amountLabel(data.comparison.summary.totalAmountMinor)}</strong>
          </div>
        ) : null}
      </div>
      {summary.incompleteCostEvents > 0 ? (
        <p role="status" className="tux-report-caveat">
          {summary.incompleteCostEvents} source event(s) lack a verified unit cost. An incomplete
          cost total is never presented as profit.
        </p>
      ) : null}
      {summary.coverageNote ? <p className="tux-report-caveat">{summary.coverageNote}</p> : null}
      {data.rows.length === 0 ? (
        <EmptyState
          title="No report events"
          description="There are no matching records for this shop and date range."
        />
      ) : (
        <div className="tux-report-results">
          <ul className="tux-report-mobile-entries" aria-label="Report entries">
            {data.rows.map((fact) => {
              const href = sourceLink(fact.sourceKind, fact.id);
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
                  const href = sourceLink(fact.sourceKind, fact.id);
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
        <span>
          Showing {filters.offset + 1}–{filters.offset + data.rows.length} of {summary.eventCount}
        </span>
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
