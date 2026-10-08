import { useMemo } from 'react';
import { Link } from 'wouter';

import { PageScaffold } from '../components/layout/PageScaffold';
import { useShopScope } from '../shops/ShopScopeProvider';
import { useReports, type ReportFilters } from '../reports/useReports';

import { OwnerSummaryCard } from './OwnerSummaryCard';
import { TargetsPanel } from './TargetsPanel';

function cairoDay(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function HomeDashboard() {
  const { principal, scope } = useShopScope();
  const shopId = scope.kind === 'shop' ? scope.shopId : principal.shopIds[0];
  const canReport = principal.permissions.includes('reports.view');
  const canFinance = principal.permissions.includes('finance.view');
  const filters = useMemo<ReportFilters>(
    () => ({
      area: 'sales',
      fromDate: cairoDay(),
      toDate: cairoDay(),
      source: null,
      shopIds: shopId ? [shopId] : [],
      comparePrevious: false,
      offset: 0,
    }),
    [shopId],
  );
  const reports = useReports(canReport ? shopId : undefined, filters);

  return (
    <PageScaffold
      eyebrow="TUX Admin"
      title="Overview"
      description="Management information from canonical shop records."
    >
      {canReport && shopId ? (
        <>
          <div className="tux-finance-toolbar">
            <h2>Today's recorded sales</h2>
            <Link className="admin-secondary-button" href="/reports">
              Open reports
            </Link>
          </div>
          {reports.reportQuery.data?.summary ? (
            <div className="tux-finance-position">
              <p className="tux-finance-muted">Sales report events</p>
              <strong className="tux-finance-position__total">
                {reports.reportQuery.data.summary.eventCount}
              </strong>
            </div>
          ) : (
            <p>Today's report is not available yet.</p>
          )}
          <TargetsPanel
            targets={reports.configQuery.data?.targets ?? []}
            filters={filters}
            summary={reports.reportQuery.data?.summary}
          />
        </>
      ) : null}
      {canFinance && shopId ? <OwnerSummaryCard shopId={shopId} /> : null}
      {!canReport && !canFinance ? <p>Choose an available workspace from navigation.</p> : null}
    </PageScaffold>
  );
}
