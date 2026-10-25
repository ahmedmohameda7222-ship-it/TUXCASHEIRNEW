import type { AdminOrderSource, AdminOrderStatus } from '@tux/admin-contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';

import { EmptyState, ErrorState, LoadingState } from '../components/feedback/AdminStates';
import { AdminMetricStrip } from '../components/layout/AdminMetricStrip';
import { PageScaffold } from '../components/layout/PageScaffold';
import { ResponsiveMasterDetail } from '../components/layout/ResponsiveMasterDetail';
import { detailIdFromPath, detailPath } from '../components/layout/detailRoute';
import { useShopScope } from '../shops/ShopScopeProvider';
import { formatEgp } from '../finance/money';
import { CancelOrderSheet } from './CancelOrderSheet';
import { OrderDetailPage } from './OrderDetailPage';
import { OnlineRequestsPanel } from './OnlineRequestsPanel';
import { RefundReturnPage } from './RefundReturnPage';
import { buildOrderSearchUrl, useOrders, type OrderSearchFilters } from './useOrders';
import { toOrderTimeRange } from './orderDateRange';
import './orders.css';

type ActionMode = 'cancel' | 'refund' | 'return' | null;

function orderStatusLabel(value: AdminOrderStatus): string {
  return { ACTIVE: 'Active', DONE: 'Completed', CANCELLED: 'Cancelled', RETURNED: 'Returned' }[
    value
  ];
}

function orderSourceLabel(value: AdminOrderSource): string {
  return value === 'POS' ? 'In-store' : 'Online';
}

function readableError(error: unknown): string | null {
  if (!error) return null;
  const raw = error instanceof Error ? error.message : String(error);
  return raw.trim().replaceAll('_', ' ').replaceAll('-', ' ') || 'Order action failed';
}

export function OrdersPage() {
  const { scope, principal } = useShopScope();
  const shopId = scope.kind === 'shop' ? scope.shopId : undefined;
  const [location, navigate] = useLocation();
  const selectedId = detailIdFromPath(location, '/orders');
  const deepLink =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();
  const [onlineView, setOnlineView] = useState(deepLink.get('view') === 'online-requests');
  const onlineDate = deepLink.get('date') ?? '';
  const initialOnlineStatus =
    deepLink.get('status') === 'PENDING' ||
    deepLink.get('status') === 'PROCESSING' ||
    deepLink.get('status') === 'ACCEPTED' ||
    deepLink.get('status') === 'REJECTED'
      ? (deepLink.get('status') as 'PENDING' | 'PROCESSING' | 'ACCEPTED' | 'REJECTED')
      : '';
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<AdminOrderStatus | ''>('');
  const [source, setSource] = useState<AdminOrderSource | ''>('');
  const [businessDayId, setBusinessDayId] = useState('');
  const [fromInput, setFromInput] = useState('');
  const [toInput, setToInput] = useState('');
  const timeRange = useMemo(() => toOrderTimeRange(fromInput, toInput), [fromInput, toInput]);
  const [action, setAction] = useState<ActionMode>(null);
  // The route is not shop-qualified. Clear a previous shop's selection and open
  // action when the authorized scope changes, but preserve initial deep links.
  const previousShopId = useRef(shopId);
  useEffect(() => {
    if (previousShopId.current === shopId) return;
    previousShopId.current = shopId;
    setAction(null);
    setBusinessDayId('');
    if (selectedId) navigate('/orders');
  }, [shopId, selectedId, navigate]);

  const authorizedShop =
    shopId && principal.shopIds.includes(shopId)
      ? principal.shopSummaries?.find((shop) => shop.id === shopId)
      : undefined;
  const shopName = authorizedShop?.name?.trim() || (shopId ? `Shop ${shopId}` : '');
  const hasActiveFilters = Boolean(
    query.trim() || status || source || businessDayId || fromInput || toInput,
  );
  const clearFilters = () => {
    setQuery('');
    setStatus('');
    setSource('');
    setBusinessDayId('');
    setFromInput('');
    setToInput('');
  };

  const filters = useMemo<OrderSearchFilters>(
    () => ({
      query,
      statuses: status ? [status] : [],
      source: source || null,
      businessDayId: businessDayId || null,
      from: timeRange.from,
      to: timeRange.to,
      limit: 50,
    }),
    [query, source, status, businessDayId, timeRange.from, timeRange.to],
  );
  const ordersApi = useOrders(shopId, selectedId, filters, timeRange.error === null);
  const rows = useMemo(
    () =>
      timeRange.error === null
        ? (ordersApi.searchQuery.data?.pages.flatMap((page) => page.rows) ?? [])
        : [],
    [ordersApi.searchQuery.data, timeRange.error],
  );

  if (!shopId) {
    return (
      <PageScaffold
        eyebrow="Orders"
        title="Orders"
        description="Orders require a single authorized shop."
      >
        <EmptyState
          title="Select a shop to view orders"
          description="Use the Shop selector above to choose an authorized shop. All Shops is not an order-history scope."
        />
      </PageScaffold>
    );
  }

  // Defense in depth: never render or mutate detail returned for another shop.
  const receivedDetail = ordersApi.detailQuery.data;
  const detail = receivedDetail?.shopId === shopId ? receivedDetail : undefined;
  const reasons = ordersApi.actionReasonsQuery.data?.reasons ?? [];
  const cancellationReasons = reasons.filter(
    (reason) => reason.active && reason.family === 'CANCELLATION',
  );
  const refundReasons = reasons.filter(
    (reason) => reason.active && reason.family === 'REFUND_RETURN',
  );
  const canCancel = principal.permissions.includes('orders.cancel');
  const canRefund = principal.permissions.includes('orders.refund');
  const canExport =
    principal.permissions.includes('orders.view') && principal.permissions.includes('reports.view');
  const actionError =
    readableError(ordersApi.cancelOrder.error) ??
    readableError(ordersApi.refundOrder.error) ??
    readableError(ordersApi.returnOrderItems.error);

  return (
    <PageScaffold
      eyebrow="Order supervision"
      title="Orders"
      description={`Search order history for ${shopName} and complete authorized order actions.`}
    >
      <div className="admin-orders-shop-context" aria-label="Current order shop">
        <span>Current shop</span>
        <strong>{shopName}</strong>
        <span>Only orders belonging to this authorized shop are shown.</span>
      </div>
      <nav aria-label="Orders workspace views" className="admin-orders-shop-context">
        <button
          type="button"
          className="admin-secondary-button"
          aria-current={!onlineView ? 'page' : undefined}
          onClick={() => setOnlineView(false)}
        >
          Canonical orders
        </button>
        <button
          type="button"
          className="admin-secondary-button"
          aria-current={onlineView ? 'page' : undefined}
          onClick={() => setOnlineView(true)}
        >
          Online requests
        </button>
      </nav>
      {onlineView ? (
        <OnlineRequestsPanel
          shopId={shopId}
          initialStatus={initialOnlineStatus}
          date={/^\d{4}-\d{2}-\d{2}$/.test(onlineDate) ? onlineDate : ''}
        />
      ) : (
        <>
          <AdminMetricStrip
            label="Orders key metrics"
            metrics={[
              { id: 'total', label: 'Total orders', value: null },
              {
                id: 'revenue',
                label: 'Total revenue',
                value: null,
                hint: principal.permissions.includes('finance.view')
                  ? 'Verified shop-wide total unavailable'
                  : 'Requires finance access',
              },
              {
                id: 'average',
                label: 'Average order value',
                value: null,
                hint: principal.permissions.includes('finance.view')
                  ? 'Verified shop-wide average unavailable'
                  : 'Requires finance access',
              },
              { id: 'active', label: 'Active orders', value: null },
            ]}
          />
          <div className="admin-orders-toolbar">
            <label className="admin-field admin-orders-search-persistent">
              <span>Search</span>
              <input
                type="search"
                value={query}
                placeholder="Order number, customer, phone or operator"
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
            <details
              className="admin-orders-filters"
              open={Boolean(status || source || businessDayId || fromInput || toInput)}
            >
              <summary>Search and filters</summary>
              <section className="admin-order-task-section is-compact" aria-label="Order filters">
                <label className="admin-field">
                  <span>Status</span>
                  <select
                    value={status}
                    onChange={(event) => setStatus(event.target.value as AdminOrderStatus | '')}
                  >
                    <option value="">All statuses</option>
                    <option value="ACTIVE">Active</option>
                    <option value="DONE">Done</option>
                    <option value="CANCELLED">Cancelled</option>
                    <option value="RETURNED">Returned</option>
                  </select>
                </label>
                <label className="admin-field">
                  <span>Operational Business Day</span>
                  <select
                    value={businessDayId}
                    onChange={(event) => setBusinessDayId(event.target.value)}
                  >
                    <option value="">All business days</option>
                    {(ordersApi.businessDaysQuery.data?.days ?? []).map((day) => (
                      <option key={day.id} value={day.id}>
                        {new Intl.DateTimeFormat('en-EG', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                          timeZone: 'Africa/Cairo',
                        }).format(new Date(day.startedAt))}{' '}
                        · {day.status} · {day.id.slice(0, 8)}
                      </option>
                    ))}
                  </select>
                  {ordersApi.businessDaysQuery.isError ? (
                    <small>Business Days are unavailable; refresh to retry.</small>
                  ) : null}
                </label>
                <label className="admin-field">
                  <span>From date/time (Cairo)</span>
                  <input
                    type="datetime-local"
                    value={fromInput}
                    onChange={(event) => setFromInput(event.currentTarget.value)}
                  />
                </label>
                <label className="admin-field">
                  <span>To date/time (Cairo)</span>
                  <input
                    type="datetime-local"
                    value={toInput}
                    min={fromInput || undefined}
                    onChange={(event) => setToInput(event.currentTarget.value)}
                  />
                </label>
                {fromInput || toInput ? (
                  <button
                    className="admin-secondary-button"
                    type="button"
                    onClick={() => {
                      setFromInput('');
                      setToInput('');
                    }}
                  >
                    Clear date filters
                  </button>
                ) : null}
                <label className="admin-field">
                  <span>Source</span>
                  <select
                    value={source}
                    onChange={(event) => setSource(event.target.value as AdminOrderSource | '')}
                  >
                    <option value="">All sources</option>
                    <option value="POS">POS</option>
                    <option value="ONLINE">Online</option>
                  </select>
                </label>
              </section>
            </details>
          </div>

          {canExport && !timeRange.error ? (
            <a
              className="admin-secondary-button"
              href={`${buildOrderSearchUrl({ shopId, ...filters })}&view=export`}
              download="tux-orders.csv"
            >
              Export up to 1,000 filtered orders (CSV)
            </a>
          ) : null}
          {timeRange.error ? <p role="alert">{timeRange.error}</p> : null}
          {actionError ? <p role="alert">{actionError}</p> : null}

          <ResponsiveMasterDetail
            listLabel="Orders"
            detailLabel="Order detail"
            detailActive={selectedId !== null}
            backHref="/orders"
            list={
              <div className="admin-orders-list">
                {ordersApi.searchQuery.isLoading ? <LoadingState title="Loading orders" /> : null}
                {ordersApi.searchQuery.isError ? (
                  <ErrorState
                    title="Orders could not be loaded"
                    action={
                      <button
                        className="admin-secondary-button"
                        type="button"
                        onClick={() => void ordersApi.searchQuery.refetch()}
                      >
                        Retry
                      </button>
                    }
                  />
                ) : null}
                {rows.length === 0 &&
                !ordersApi.searchQuery.isLoading &&
                !ordersApi.searchQuery.isError &&
                !timeRange.error ? (
                  <EmptyState
                    title={
                      hasActiveFilters
                        ? 'No orders match these filters'
                        : 'No orders in this shop yet'
                    }
                    description={
                      hasActiveFilters
                        ? `No results in ${shopName}. Clear the filters to return to its complete order history.`
                        : `No order history exists for ${shopName} yet. New orders will appear here. To review another shop, use the Shop selector above.`
                    }
                    action={
                      hasActiveFilters ? (
                        <button
                          type="button"
                          className="admin-secondary-button"
                          onClick={clearFilters}
                        >
                          Clear order filters
                        </button>
                      ) : undefined
                    }
                  />
                ) : null}
                {rows.map((row) => (
                  <button
                    className={
                      row.id === selectedId ? 'admin-order-row is-selected' : 'admin-order-row'
                    }
                    aria-current={row.id === selectedId ? 'true' : undefined}
                    key={row.id}
                    type="button"
                    onClick={() => {
                      navigate(detailPath('/orders', row.id));
                      setAction(null);
                    }}
                  >
                    <span className="admin-order-row__identity">
                      <strong>{row.displayOrderLabel ?? `#${row.displayOrderNo}`}</strong>
                      <small>{row.customerName ?? row.normalizedPhone ?? 'Walk-in'}</small>
                      <small>
                        {row.orderTypeLabel} · {orderSourceLabel(row.source)}
                      </small>
                    </span>
                    <span className="admin-order-row__summary">
                      <b className="admin-order-row__amount">{formatEgp(row.totalMinor)}</b>
                      <span className="admin-order-row__status">
                        {orderStatusLabel(row.status)}
                      </span>
                      <time dateTime={row.createdAt}>
                        {new Intl.DateTimeFormat('en-EG', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                          timeZone: 'Africa/Cairo',
                        }).format(new Date(row.createdAt))}
                      </time>
                    </span>
                  </button>
                ))}
                {ordersApi.searchQuery.hasNextPage ? (
                  <button
                    className="admin-secondary-button"
                    type="button"
                    disabled={ordersApi.searchQuery.isFetchingNextPage}
                    onClick={() => void ordersApi.searchQuery.fetchNextPage()}
                  >
                    {ordersApi.searchQuery.isFetchingNextPage ? 'Loading…' : 'Load more'}
                  </button>
                ) : null}
              </div>
            }
            detail={
              ordersApi.detailQuery.isLoading ? (
                <LoadingState title="Loading order detail" />
              ) : ordersApi.detailQuery.isError ? (
                <ErrorState
                  title="Order unavailable"
                  description={`This order may not exist or may not be accessible in ${shopName}. Return to the current shop's orders.`}
                  action={
                    <button
                      className="admin-secondary-button"
                      type="button"
                      onClick={() => navigate('/orders')}
                    >
                      Back to shop orders
                    </button>
                  }
                />
              ) : detail ? (
                <>
                  <OrderDetailPage
                    order={detail}
                    canCancel={canCancel}
                    canRefund={canRefund}
                    canReviewApprovals={principal.permissions.includes('approvals.review')}
                    canViewDelivery={principal.permissions.includes('delivery.view')}
                    cancelling={ordersApi.cancelOrder.isPending}
                    refunding={ordersApi.refundOrder.isPending}
                    returning={ordersApi.returnOrderItems.isPending}
                    onCancel={() => setAction('cancel')}
                    onRefund={() => setAction('refund')}
                    onReturn={() => setAction('return')}
                  />
                  {action === 'cancel' ? (
                    <CancelOrderSheet
                      order={detail}
                      reasons={cancellationReasons}
                      pending={ordersApi.cancelOrder.isPending}
                      onCancel={() => setAction(null)}
                      onSubmit={(input) =>
                        ordersApi.cancelOrder.mutate(
                          {
                            orderId: detail.id,
                            expectedOperationalRevision: detail.operationalRevision,
                            ...input,
                          },
                          { onSuccess: () => setAction(null) },
                        )
                      }
                    />
                  ) : null}
                  {action === 'refund' || action === 'return' ? (
                    <RefundReturnPage
                      mode={action}
                      order={detail}
                      reasons={refundReasons}
                      refunding={ordersApi.refundOrder.isPending}
                      returning={ordersApi.returnOrderItems.isPending}
                      onCancel={() => setAction(null)}
                      onRefund={(input) =>
                        ordersApi.refundOrder.mutate(
                          { orderId: detail.id, ...input },
                          { onSuccess: () => setAction(null) },
                        )
                      }
                      onReturn={(input) =>
                        ordersApi.returnOrderItems.mutate(
                          { orderId: detail.id, ...input },
                          { onSuccess: () => setAction(null) },
                        )
                      }
                    />
                  ) : null}
                </>
              ) : (
                <EmptyState
                  title="Order unavailable in this shop"
                  description={`This order is not available in ${shopName}. Open an order from the current shop's history instead.`}
                  action={
                    <button
                      className="admin-secondary-button"
                      type="button"
                      onClick={() => navigate('/orders')}
                    >
                      Back to shop orders
                    </button>
                  }
                />
              )
            }
            emptyDetail={
              <EmptyState
                title="Select an order"
                description="Review payment, customer, delivery, inventory status and order history."
              />
            }
          />
        </>
      )}
    </PageScaffold>
  );
}
