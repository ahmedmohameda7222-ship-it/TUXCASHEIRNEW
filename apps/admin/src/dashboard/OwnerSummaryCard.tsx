import { Link } from 'wouter';

import { ErrorState, LoadingState } from '../components/feedback/AdminStates';
import { formatEgp } from '../finance/money';
import { useOwnerSummary } from '../finance/useFinanceOperations';

const summaryMetrics = [
  { field: 'netSalesMinor', label: 'Net sales', kind: 'money' },
  { field: 'estimatedOperatingProfitMinor', label: 'Operating estimate', kind: 'money' },
  { field: 'orderCount', label: 'Orders', kind: 'count' },
  { field: 'cashVarianceMinor', label: 'Net cash difference', kind: 'money' },
  { field: 'cashVarianceCount', label: 'Cash count differences', kind: 'count' },
  { field: 'lowStockCount', label: 'Low stock items', kind: 'count' },
  { field: 'majorPostedRefundCount', label: 'Significant posted refunds', kind: 'count' },
  { field: 'failedOnlineOrderCount', label: 'Failed online orders', kind: 'count' },
  { field: 'pendingApprovalCount', label: 'Pending approvals', kind: 'count' },
] as const;

export function OwnerSummaryCard({ shopId }: { shopId: string }) {
  const query = useOwnerSummary(shopId);
  const latest = query.data?.summaries[0];
  const authorizedMetrics = summaryMetrics.filter((metric) => {
    const value = latest?.summary[metric.field];
    return typeof value === 'number' && Number.isSafeInteger(value);
  });

  return (
    <section className="tux-owner-summary" aria-label="Daily Owner Summary">
      <div className="tux-finance-toolbar">
        <h2>Daily Owner Summary</h2>
        <Link className="admin-secondary-button" href="/finance/end-day">
          End Day history
        </Link>
      </div>
      {query.isLoading ? (
        <LoadingState title="Loading Owner Summary" />
      ) : query.isError ? (
        <ErrorState
          title="Owner Summary unavailable"
          description="The financial summary could not be loaded."
          action={
            <button type="button" className="admin-secondary-button" onClick={() => void query.refetch()}>
              Retry
            </button>
          }
        />
      ) : query.data?.summaries.length === 0 ? (
        <p>No finalized financial day has generated an Owner Summary for this shop yet.</p>
      ) : latest ? (
        <div>
          <p className="tux-finance-muted">
            Generated{' '}
            {new Date(latest.generated_at).toLocaleString('en-EG', { timeZone: 'Africa/Cairo' })}
          </p>
          {authorizedMetrics.length > 0 && (
            <dl className="tux-finance-x-grid">
              {authorizedMetrics.map(({ field, label, kind }) => {
                const value = latest.summary[field] as number;
                return (
                  <div key={field}>
                    <dt>{label}</dt>
                    <dd>{kind === 'money' ? formatEgp(value) : value.toLocaleString('en-EG')}</dd>
                  </div>
                );
              })}
            </dl>
          )}
          <Link href="/reports">Open source reports</Link>
        </div>
      ) : (
        <LoadingState title="Loading Owner Summary" />
      )}
    </section>
  );
}
