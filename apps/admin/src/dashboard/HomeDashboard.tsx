import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';

import { PageScaffold } from '../components/layout/PageScaffold';
import { formatEgp } from '../finance/money';
import { adminFetch } from '../lib/adminApi';
import { useReports, type ReportFilters } from '../reports/useReports';
import { useShopScope } from '../shops/ShopScopeProvider';

import { OwnerSummaryCard } from './OwnerSummaryCard';
import { TargetsPanel } from './TargetsPanel';
import './homeDashboard.css';

type HomeMetrics = {
  ok: true;
  netSalesMinor: number;
  orderCount: number;
  averageOrderMinor: number | null;
  estimatedOperatingProfitMinor: number | null;
  lowStockCount: number | null;
  outOfStockCount: number | null;
  failedOnlineOrderCount: number;
  pendingApprovalCount: number | null;
  staffOnShiftCount: number | null;
  deliveryOpenCount: number | null;
  salesTrend: readonly { date: string; netSalesMinor: number }[];
  topProducts: readonly { name: string; quantity: number; recordedSalesMinor: number }[];
  sourceMix: readonly { source: string; orderCount: number }[];
  shopComparison: readonly { shopName: string; orderCount: number; netSalesMinor: number }[];
};

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

function priorDay(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function metric(value: number | null | undefined, money = false): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? money
      ? formatEgp(value)
      : value.toLocaleString('en-EG')
    : 'Not available';
}

export function HomeDashboard() {
  const { principal, scope } = useShopScope();
  const shopId = scope.kind === 'shop' ? scope.shopId : principal.shopIds[0];
  const canReport = principal.permissions.includes('reports.view');
  const canFinance = principal.permissions.includes('finance.view');
  const canInventory = principal.permissions.includes('inventory.view');
  const canStaff = principal.permissions.includes('staff.view');
  const canDelivery = principal.permissions.includes('delivery.view');
  const canCatalog = principal.permissions.includes('catalog.view');
  const canApprovals = principal.permissions.includes('approvals.review');
  const canShowAll = principal.role === 'OWNER' || principal.role === 'ADMIN';
  const scopeIds =
    scope.kind === 'all-shops' && canShowAll ? principal.shopIds : shopId ? [shopId] : [];
  const today = cairoDay();
  const fromWeek = priorDay(today, 6);
  const filters: ReportFilters = {
    area: 'sales',
    fromDate: today,
    toDate: today,
    source: null,
    shopIds: scopeIds,
    comparePrevious: false,
    offset: 0,
  };
  const reports = useReports(canReport ? shopId : undefined, filters, false);
  const readDashboard = (from: string, to: string) => {
    const params = new URLSearchParams({ shopId: shopId!, view: 'dashboard', from, to });
    for (const id of scopeIds) params.append('reportShopId', id);
    return adminFetch<HomeMetrics>(`/api/admin/reports?${params}`);
  };
  const todayMetrics = useQuery({
    queryKey: ['admin', 'home', principal.employeeId, scopeIds, today],
    enabled: Boolean(shopId && canReport),
    queryFn: () => readDashboard(today, today),
  });
  const weekMetrics = useQuery({
    queryKey: ['admin', 'home', 'week', principal.employeeId, scopeIds, fromWeek, today],
    enabled: Boolean(shopId && canReport),
    queryFn: () => readDashboard(fromWeek, today),
  });
  const current = todayMetrics.data;
  const historic = weekMetrics.data;
  const role = principal.role;
  const ownerView = role === 'OWNER' || role === 'ADMIN';
  const trendMax = Math.max(
    1,
    ...(historic?.salesTrend ?? []).map((x) => Math.max(0, x.netSalesMinor)),
  );
  const kpis: Array<readonly [string, string]> = [
    ['Net sales today', metric(current?.netSalesMinor, true)],
    ['Orders today', metric(current?.orderCount)],
    ['Average order value', metric(current?.averageOrderMinor, true)],
    ...(canFinance
      ? [
          [
            'Estimated operating profit',
            metric(current?.estimatedOperatingProfitMinor, true),
          ] as const,
        ]
      : []),
    ...(canInventory
      ? [
          ['Low-stock items', metric(current?.lowStockCount)] as const,
          ['Out-of-stock items', metric(current?.outOfStockCount)] as const,
        ]
      : []),
    ...(canStaff ? [['Staff clocked in', metric(current?.staffOnShiftCount)] as const] : []),
    ...(canDelivery ? [['Active deliveries', metric(current?.deliveryOpenCount)] as const] : []),
    ...(canApprovals
      ? [['Pending approvals', metric(current?.pendingApprovalCount)] as const]
      : []),
    ['Failed online orders', metric(current?.failedOnlineOrderCount)],
  ];
  return (
    <PageScaffold
      eyebrow="TUX Admin"
      title="Home"
      description={
        ownerView
          ? 'Business performance from recorded transactions and operational events.'
          : 'Your authorized shop operations and recorded activity.'
      }
    >
      {canReport && shopId ? (
        <>
          <div className="tux-finance-toolbar">
            <h2>{ownerView ? 'Business overview' : 'Shop overview'}</h2>
            <Link className="admin-secondary-button" href="/reports">
              Open reports
            </Link>
          </div>
          {todayMetrics.isError ? <p role="alert">Current dashboard data is unavailable.</p> : null}
          <div className="tux-home-kpis">
            {kpis.map(([label, value]) => (
              <div key={label} className="tux-home-kpi">
                <small>{label}</small>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          {weekMetrics.isError ? <p role="alert">Historical trends are unavailable.</p> : null}
          {historic ? (
            <div className="tux-home-insights">
              <section aria-label="Seven-day sales trend">
                <h2>Sales trend · 7 days</h2>
                <ul className="tux-home-trend">
                  {historic.salesTrend.map((item) => (
                    <li key={item.date}>
                      <span
                        className="tux-home-trend__bar"
                        style={{
                          height: `${Math.max(3, Math.round((Math.max(0, item.netSalesMinor) / trendMax) * 100))}%`,
                        }}
                        aria-hidden="true"
                      />
                      <small>{item.date.slice(5)}</small>
                      <span>{formatEgp(item.netSalesMinor)}</span>
                    </li>
                  ))}
                </ul>
              </section>
              {canCatalog ? (
                <section aria-label="Top recorded products">
                  <h2>Top products · 7 days</h2>
                  {historic.topProducts.length === 0 ? (
                    <p>No recorded products this week.</p>
                  ) : (
                    <ol className="tux-home-insight-list">
                      {historic.topProducts.map((item, index) => (
                        <li key={`${index}:${item.name}`}>
                          <span>{item.name}</span>
                          <strong>{metric(item.quantity)} sold</strong>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              ) : null}
              <section aria-label="Sales channels">
                <h2>POS vs online · 7 days</h2>
                {historic.sourceMix.length === 0 ? (
                  <p>No recorded orders this week.</p>
                ) : (
                  <dl className="tux-home-insight-list">
                    {historic.sourceMix.map((item) => (
                      <div key={item.source}>
                        <dt>
                          {item.source === 'POS'
                            ? 'In-store POS'
                            : item.source === 'ONLINE'
                              ? 'Online'
                              : 'Other'}
                        </dt>
                        <dd>{metric(item.orderCount)} orders</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </section>
              {ownerView && scopeIds.length > 1 ? (
                <section aria-label="Authorized shop comparison">
                  <h2>Shop comparison · 7 days</h2>
                  <dl className="tux-home-insight-list">
                    {historic.shopComparison.map((item) => (
                      <div key={item.shopName}>
                        <dt>{item.shopName}</dt>
                        <dd>
                          {formatEgp(item.netSalesMinor)} · {metric(item.orderCount)} orders
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ) : null}
            </div>
          ) : null}
          <TargetsPanel
            targets={reports.configQuery.data?.targets ?? []}
            filters={filters}
            summary={reports.reportQuery.data?.summary}
          />
          {!ownerView ? (
            <nav className="tux-finance-toolbar" aria-label="Operations shortcuts">
              {canFinance ? (
                <Link className="admin-secondary-button" href="/finance/end-day">
                  Cash reconciliation
                </Link>
              ) : null}
              {principal.permissions.includes('delivery.view') ? (
                <Link className="admin-secondary-button" href="/delivery">
                  Delivery status
                </Link>
              ) : null}
              {principal.permissions.includes('staff.view') ? (
                <Link className="admin-secondary-button" href="/staff">
                  Staff overview
                </Link>
              ) : null}
            </nav>
          ) : null}
        </>
      ) : null}
      {canFinance && shopId ? <OwnerSummaryCard shopId={shopId} /> : null}
      {!canReport && !canFinance ? <p>Choose an available workspace from navigation.</p> : null}
    </PageScaffold>
  );
}
