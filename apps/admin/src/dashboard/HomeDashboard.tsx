import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';

import { EmptyState, ErrorState, LoadingState } from '../components/feedback/AdminStates';
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
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() - days);
  return result.toISOString().slice(0, 10);
}

function valueOf(value: number | null | undefined, money = false): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Unavailable';
  return money ? formatEgp(value) : value.toLocaleString('en-EG');
}

function MetricCard({
  label,
  value,
  money = false,
  description,
}: {
  label: string;
  value: number | null | undefined;
  money?: boolean;
  description: string;
}) {
  const available = typeof value === 'number' && Number.isFinite(value);
  return (
    <div className={available ? 'tux-home-kpi' : 'tux-home-kpi is-unavailable'}>
      <dt>{label}</dt>
      <dd>{valueOf(value, money)}</dd>
      <span>{available && value === 0 ? 'No recorded activity' : description}</span>
    </div>
  );
}

export function HomeDashboard() {
  const { principal, scope } = useShopScope();
  const shopId = scope.kind === 'shop' ? scope.shopId : principal.shopIds[0];
  const isAllShops = scope.kind === 'all-shops';
  const permissions = principal.permissions;
  const canReport = permissions.includes('reports.view');
  const canFinance = permissions.includes('finance.view');
  const canInventory = permissions.includes('inventory.view');
  const canStaff = permissions.includes('staff.view');
  const canDelivery = permissions.includes('delivery.view');
  const canCatalog = permissions.includes('catalog.view');
  const canApprovals = permissions.includes('approvals.review');
  const canOrders = permissions.includes('orders.view');
  const ownerView = principal.role === 'OWNER' || principal.role === 'ADMIN';
  const canShowAll = ownerView;
  const scopeIds =
    isAllShops && canShowAll ? principal.shopIds : shopId ? [shopId] : [];
  const selectedShop = principal.shopSummaries?.find(
    (shop) => shop.id === shopId && principal.shopIds.includes(shop.id),
  );
  const contextName = isAllShops ? 'All authorized shops' : (selectedShop?.name ?? 'Shop unavailable');
  const operationalStatus = isAllShops
    ? 'Aggregated view · select a shop for shop-specific actions'
    : selectedShop?.active === false
      ? 'Inactive'
      : selectedShop?.temporaryClosed === true
        ? 'Temporarily closed'
        : selectedShop?.active === true
          ? 'Active · not marked temporarily closed'
          : 'Operational status unavailable';
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
  const reports = useReports(canReport ? shopId : undefined, filters, false, false);
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
  const trendMax = Math.max(
    1,
    ...(historic?.salesTrend ?? []).map((point) => Math.max(0, point.netSalesMinor)),
  );
  const exceptionSignals = [
    { label: 'Failed online orders', count: current?.failedOnlineOrderCount, href: canOrders ? '/orders' : null },
    ...(canApprovals
      ? [{ label: 'Pending approvals', count: current?.pendingApprovalCount, href: '/approvals' }]
      : []),
    ...(canInventory
      ? [
          { label: 'Out-of-stock items', count: current?.outOfStockCount, href: '/inventory' },
          { label: 'Low-stock items', count: current?.lowStockCount, href: '/inventory' },
        ]
      : []),
  ];
  const knownSignals = exceptionSignals.filter(
    (item) => typeof item.count === 'number' && Number.isFinite(item.count),
  );
  const exceptions = knownSignals.filter((item) => (item.count ?? 0) > 0);
  const shortcuts = [
    { label: 'Review orders', href: '/orders', permitted: canOrders },
    { label: 'Inspect inventory', href: '/inventory', permitted: canInventory },
    { label: 'Review approvals', href: '/approvals', permitted: canApprovals },
    { label: 'Open reports', href: '/reports', permitted: canReport },
    { label: 'Cash reconciliation', href: '/finance/end-day', permitted: canFinance },
    { label: 'Delivery status', href: '/delivery', permitted: canDelivery },
    { label: 'Staff overview', href: '/staff', permitted: canStaff },
  ].filter((action) => action.permitted);

  return (
    <PageScaffold
      eyebrow="TUX Precision · Management"
      title="Home"
      description={
        ownerView
          ? 'A decision-focused view of recorded business activity and the areas that need review.'
          : 'Recorded activity and the operational workspaces authorized for your role.'
      }
    >
      <div className="tux-home-layout">
        <section className="tux-home-context" aria-label="Current business context">
          <div>
            <span className="tux-home-eyebrow">{ownerView ? 'Business overview' : 'Shop overview'}</span>
            <h2>{contextName}</h2>
            <p>{operationalStatus}</p>
          </div>
          <div className="tux-home-context__meta">
            <span>{principal.role === 'OWNER' ? 'Owner' : principal.role === 'ADMIN' ? 'Administrator' : principal.role === 'MANAGER' ? 'Manager' : 'Staff'}</span>
            <span>Business date · {today} (Cairo)</span>
          </div>
        </section>

        {canReport && shopId ? (
          <>
            {todayMetrics.isPending ? (
              <div className="tux-home-pending" aria-busy="true">
                <LoadingState title="Loading today's recorded activity" />
                <div className="tux-home-kpis" aria-hidden="true">
                  {[1, 2, 3].map((item) => <div key={item} className="tux-home-kpi tux-home-kpi--skeleton" />)}
                </div>
              </div>
            ) : todayMetrics.isError ? (
              <ErrorState
                title="Current dashboard data is unavailable"
                description="No sales or exception values can be confirmed right now. Previously recorded data has not been changed."
                action={
                  <button type="button" className="admin-secondary-button" onClick={() => void todayMetrics.refetch()}>
                    Retry dashboard
                  </button>
                }
              />
            ) : current ? (
              <>
                <section className="tux-home-priorities" aria-label="Needs attention">
                  <div className="tux-home-section-heading">
                    <div>
                      <span className="tux-home-eyebrow">Operational exceptions · today</span>
                      <h2>Needs attention</h2>
                    </div>
                    <span className="tux-home-date">As recorded for {today}</span>
                  </div>
                  {exceptions.length ? (
                    <div className="tux-home-alerts">
                      {exceptions.map((item) => (
                        <div key={item.label} className="tux-home-alert">
                          <div>
                            <strong className="tux-home-alert__value">{valueOf(item.count)}</strong>
                            <span>{item.label}</span>
                          </div>
                          {item.href ? <Link href={item.href} aria-label={`Review ${item.label.toLowerCase()}`}>Review <span aria-hidden="true">→</span></Link> : null}
                        </div>
                      ))}
                    </div>
                  ) : knownSignals.length === exceptionSignals.length ? (
                    <p className="tux-home-calm">No flagged exceptions in the available daily report.</p>
                  ) : (
                    <p className="tux-home-calm">Some exception counts are unavailable. Open the relevant workspace for details.</p>
                  )}
                </section>

                <section className="tux-home-daily" aria-label="Today's recorded performance">
                  <div className="tux-home-section-heading">
                    <div>
                      <span className="tux-home-eyebrow">Daily overview · {today}</span>
                      <h2>Recorded performance</h2>
                    </div>
                    <Link className="admin-secondary-button" href="/reports">Open reports</Link>
                  </div>
                  <dl className="tux-home-kpis">
                    <MetricCard label="Net sales today" value={current.netSalesMinor} money description="Recorded net sales · EGP" />
                    <MetricCard label="Orders today" value={current.orderCount} description="Recorded order count" />
                    <MetricCard label="Average order value" value={current.averageOrderMinor} money description="EGP per recorded order" />
                    {canFinance ? <MetricCard label="Estimated operating profit" value={current.estimatedOperatingProfitMinor} money description="Estimate · not finalized profit" /> : null}
                  </dl>
                </section>
                {canStaff || canDelivery ? (
                  <section className="tux-home-operations" aria-label="Operations snapshot">
                    <div className="tux-home-section-heading"><h2>Operations snapshot</h2></div>
                    <dl className="tux-home-kpis tux-home-kpis--secondary">
                      {canStaff ? <MetricCard label="Staff clocked in" value={current.staffOnShiftCount} description="Reported on shift" /> : null}
                      {canDelivery ? <MetricCard label="Active deliveries" value={current.deliveryOpenCount} description="Reported open deliveries" /> : null}
                    </dl>
                  </section>
                ) : null}
              </>
            ) : (
              <EmptyState title="No dashboard response" description="The reporting workspace did not return current-day values." />
            )}

            <section className="tux-home-analytics" aria-label="Seven-day business context">
              <div className="tux-home-section-heading">
                <div>
                  <span className="tux-home-eyebrow">Historical context · {fromWeek} to {today}</span>
                  <h2>Seven-day view</h2>
                </div>
              </div>
              {weekMetrics.isPending ? (
                <LoadingState title="Loading seven-day history" />
              ) : weekMetrics.isError ? (
                <ErrorState
                  title="Historical trends are unavailable"
                  action={<button type="button" className="admin-secondary-button" onClick={() => void weekMetrics.refetch()}>Retry history</button>}
                />
              ) : historic ? (
                <div className="tux-home-insights">
                  <section aria-label="Seven-day sales trend">
                    <h2>Sales trend · 7 days</h2>
                    {historic.salesTrend.length === 0 ? (
                      <p>No recorded sales trend for this period.</p>
                    ) : (
                      <ul className="tux-home-trend">
                        {historic.salesTrend.map((item) => (
                          <li key={item.date} aria-label={`${item.date}: ${formatEgp(item.netSalesMinor)}`}>
                            <span className="tux-home-trend__bar" style={{ height: `${Math.max(3, Math.round(Math.max(0, item.netSalesMinor) / trendMax * 100))}%` }} aria-hidden="true" />
                            <small>{item.date.slice(5)}</small>
                            <span>{formatEgp(item.netSalesMinor)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                  {canCatalog ? (
                    <section aria-label="Top recorded products">
                      <h2>Top products · 7 days</h2>
                      {historic.topProducts.length === 0 ? <p>No recorded products this week.</p> : (
                        <ol className="tux-home-insight-list">
                          {historic.topProducts.map((item, index) => (
                            <li key={`${index}:${item.name}`}><span>{item.name}</span><strong>{valueOf(item.quantity)} sold</strong></li>
                          ))}
                        </ol>
                      )}
                    </section>
                  ) : null}
                  <section aria-label="Sales channels">
                    <h2>POS vs online · 7 days</h2>
                    {historic.sourceMix.length === 0 ? <p>No recorded orders this week.</p> : (
                      <dl className="tux-home-insight-list">
                        {historic.sourceMix.map((item) => (
                          <div key={item.source}>
                            <dt>{item.source === 'POS' ? 'In-store POS' : item.source === 'ONLINE' ? 'Online' : 'Other'}</dt>
                            <dd>{valueOf(item.orderCount)} orders</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </section>
                  {ownerView && scopeIds.length > 1 ? (
                    <section aria-label="Authorized shop comparison">
                      <h2>Shop comparison · 7 days</h2>
                      {historic.shopComparison.length === 0 ? <p>No shop comparison returned.</p> : (
                        <dl className="tux-home-insight-list">
                          {historic.shopComparison.map((item, index) => (
                            <div key={`${index}:${item.shopName}`}><dt>{item.shopName}</dt><dd>{formatEgp(item.netSalesMinor)} · {valueOf(item.orderCount)} orders</dd></div>
                          ))}
                        </dl>
                      )}
                    </section>
                  ) : null}
                </div>
              ) : <EmptyState title="No historical report" description="No seven-day report is currently available." />}
            </section>
            <TargetsPanel
              targets={reports.configQuery.data?.targets ?? []}
              filters={filters}
              summary={reports.reportQuery.data?.summary}
            />
          </>
        ) : !canReport ? (
          <section className="tux-home-no-report">
            <EmptyState title="Reporting is not enabled for this role" description="Choose an authorized workspace below. Nothing is shown from restricted reports." />
          </section>
        ) : (
          <EmptyState title="No assigned shops" description="No authorized shop is available to summarize." />
        )}

        <section className="tux-home-actions" aria-label="Authorized next actions">
          <div className="tux-home-section-heading">
            <div>
              <span className="tux-home-eyebrow">Within your permissions</span>
              <h2>Continue working</h2>
            </div>
          </div>
          {shortcuts.length ? (
            <nav className="tux-home-actions__grid" aria-label="Authorized management shortcuts">
              {shortcuts.map((item) => (
                <Link key={item.href} href={item.href}>{item.label}<span aria-hidden="true">→</span></Link>
              ))}
            </nav>
          ) : <p>No additional workspaces are authorized for this account.</p>}
        </section>
        {canFinance && shopId && !isAllShops ? <OwnerSummaryCard shopId={shopId} /> : null}
      </div>
    </PageScaffold>
  );
}
