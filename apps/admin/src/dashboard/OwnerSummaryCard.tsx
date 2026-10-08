import { Link } from 'wouter';

import { formatEgp } from '../finance/money';
import { useFinanceOperations } from '../finance/useFinanceOperations';

function metric(summary: Readonly<Record<string, unknown>>, field: string): string {
  const value = summary[field];
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? formatEgp(value)
    : 'Not available';
}
function count(summary: Readonly<Record<string, unknown>>, field: string): string {
  const value = summary[field];
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? value.toLocaleString('en-EG')
    : 'Not available';
}

export function OwnerSummaryCard({ shopId }: { shopId: string }) {
  const finance = useFinanceOperations(shopId, undefined);
  const latest = finance.ownerSummaryQuery.data?.summaries[0];
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
          <dl className="tux-finance-x-grid">
            <div>
              <dt>Net sales</dt>
              <dd>{metric(latest.summary, 'netSalesMinor')}</dd>
            </div>
            <div>
              <dt>Operating estimate</dt>
              <dd>{metric(latest.summary, 'estimatedOperatingProfitMinor')}</dd>
            </div>
            <div>
              <dt>Orders</dt>
              <dd>{count(latest.summary, 'orderCount')}</dd>
            </div>
            <div>
              <dt>Net cash difference</dt>
              <dd>{metric(latest.summary, 'cashVarianceMinor')}</dd>
            </div>
            <div>
              <dt>Cash count differences</dt>
              <dd>{count(latest.summary, 'cashVarianceCount')}</dd>
            </div>
            <div>
              <dt>Low stock items</dt>
              <dd>{count(latest.summary, 'lowStockCount')}</dd>
            </div>
            <div>
              <dt>Significant posted refunds</dt>
              <dd>{count(latest.summary, 'majorPostedRefundCount')}</dd>
            </div>
            <div>
              <dt>Failed online orders</dt>
              <dd>{count(latest.summary, 'failedOnlineOrderCount')}</dd>
            </div>
            <div>
              <dt>Pending approvals</dt>
              <dd>{count(latest.summary, 'pendingApprovalCount')}</dd>
            </div>
          </dl>
          <Link href="/reports">Open source reports</Link>
        </div>
      )}
    </section>
  );
}
