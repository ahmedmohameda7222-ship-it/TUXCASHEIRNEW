import type { AdminOrderSource, AdminOrderStatus } from '@tux/admin-contracts';
import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';

import { EmptyState, ErrorState, LoadingState } from '../components/feedback/AdminStates';
import { PageScaffold } from '../components/layout/PageScaffold';
import { ResponsiveMasterDetail } from '../components/layout/ResponsiveMasterDetail';
import { detailIdFromPath, detailPath } from '../components/layout/detailRoute';
import { useShopScope } from '../shops/ShopScopeProvider';
import { CancelOrderSheet } from './CancelOrderSheet';
import { OrderDetailPage } from './OrderDetailPage';
import { RefundReturnPage } from './RefundReturnPage';
import { useOrders, type OrderSearchFilters } from './useOrders';

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
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<AdminOrderStatus | ''>('');
  const [source, setSource] = useState<AdminOrderSource | ''>('');
  const [action, setAction] = useState<ActionMode>(null);

  const filters = useMemo<OrderSearchFilters>(
    () => ({
      query,
      statuses: status ? [status] : [],
      source: source || null,
      from: null,
      to: null,
      limit: 50,
    }),
    [query, source, status],
  );
  const ordersApi = useOrders(shopId, selectedId, filters);
  const rows = useMemo(
    () => ordersApi.searchQuery.data?.pages.flatMap((page) => page.rows) ?? [],
    [ordersApi.searchQuery.data],
  );

  if (!shopId) {
    return (
      <PageScaffold
        eyebrow="Orders"
        title="Orders"
        description="Select a shop to review orders, cancellations, refunds and returns."
      />
    );
  }

  const detail = ordersApi.detailQuery.data;
  const reasons = ordersApi.actionReasonsQuery.data?.reasons ?? [];
  const cancellationReasons = reasons.filter(
    (reason) => reason.active && reason.family === 'CANCELLATION',
  );
  const refundReasons = reasons.filter(
    (reason) => reason.active && reason.family === 'REFUND_RETURN',
  );
  const canCancel = principal.permissions.includes('orders.cancel');
  const canRefund = principal.permissions.includes('orders.refund');
  const actionError =
    readableError(ordersApi.cancelOrder.error) ??
    readableError(ordersApi.refundOrder.error) ??
    readableError(ordersApi.returnOrderItems.error);

  return (
    <PageScaffold
      eyebrow="Order supervision"
      title="Orders"
      description="Search order history and complete controlled cancellation, refund or return actions."
    >
      <details className="admin-orders-filters" open={Boolean(query || status || source)}>
        <summary>Search and filters</summary>
        <section className="admin-catalog-editor__section is-compact" aria-label="Order filters">
          <label className="admin-field">
            <span>Search</span>
            <input
              value={query}
              placeholder="Order number, customer, phone or operator"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
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

      {actionError ? <p role="alert">{actionError}</p> : null}

      <ResponsiveMasterDetail
        listLabel="Orders"
        detailLabel="Order detail"
        detailActive={selectedId !== null}
        backHref="/orders"
        list={
          <div className="admin-inventory-list">
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
            {rows.length === 0 && !ordersApi.searchQuery.isLoading && !ordersApi.searchQuery.isError ? (
              <EmptyState
                title="No matching orders"
                description="Adjust the search or filters for this shop."
              />
            ) : null}
            {rows.map((row) => (
              <button
                className={
                  row.id === selectedId ? 'admin-inventory-row is-selected' : 'admin-inventory-row'
                }
                aria-current={row.id === selectedId ? 'true' : undefined}
                key={row.id}
                type="button"
                onClick={() => {
                  navigate(detailPath('/orders', row.id));
                  setAction(null);
                }}
              >
                <span>
                  <strong>{row.displayOrderLabel ?? `#${row.displayOrderNo}`}</strong>
                  <small>
                    {row.customerName ?? row.normalizedPhone ?? 'Walk-in'} · {row.orderTypeLabel}
                  </small>
                </span>
                <span>
                  {orderStatusLabel(row.status)} · {orderSourceLabel(row.source)}
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
              description="This order may not exist or may not be available in your current shop scope."
            />
          ) : detail ? (
            <>
              <OrderDetailPage
                order={detail}
                canCancel={canCancel}
                canRefund={canRefund}
                cancelling={ordersApi.cancelOrder.isPending}
                refunding={ordersApi.refundOrder.isPending}
                returning={ordersApi.returnOrderItems.isPending}
                onCancel={() => setAction('cancel')}
                onRefund={() => setAction('refund')}
                onReturn={() => setAction('return')}
              />
              {action === 'cancel' ? (
                <CancelOrderSheet
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
              title="Order unavailable"
              description="Choose another order from the list."
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
    </PageScaffold>
  );
}
