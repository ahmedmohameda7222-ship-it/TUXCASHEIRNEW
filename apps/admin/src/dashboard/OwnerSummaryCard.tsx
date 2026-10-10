import { Link } from 'wouter';

import { formatEgp } from '../finance/money';
import { useFinanceOperations } from '../finance/useFinanceOperations';

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
  const finance = useFinanceOperations(shopId, undefined);
  const latest = finance.ownerSummaryQuery.data?.summaries[0];
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
      {!latest ? (
        <p>No finalized financial day has generated an Owner Summary for this shop yet.</p>
      ) : (
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
      )}
    </section>
  );
}
