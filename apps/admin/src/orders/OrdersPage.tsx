import type { AdminOrderSource, AdminOrderStatus } from '@tux/admin-contracts';
import { useEffect, useMemo, useState } from 'react';

import { PageScaffold } from '../components/layout/PageScaffold';
import { useShopScope } from '../shops/ShopScopeProvider';
import { CancelOrderSheet } from './CancelOrderSheet';
import { OrderDetailPage } from './OrderDetailPage';
import { RefundReturnPage } from './RefundReturnPage';
import { useOrders, type OrderSearchFilters } from './useOrders';

type ActionMode = 'cancel' | 'refund-return' | null;

function readableError(error: unknown): string | null {
  if (!error) return null;
  const raw = error instanceof Error ? error.message : String(error);
  return raw.trim().replaceAll('_', ' ').replaceAll('-', ' ') || 'Order action failed';
}

export function OrdersPage() {
  const { scope, principal } = useShopScope();
  const shopId = scope.kind === 'shop' ? scope.shopId : undefined;
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<AdminOrderStatus | ''>('');
  const [source, setSource] = useState<AdminOrderSource | ''>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  useEffect(() => {
    if (selectedId && rows.some((row) => row.id === selectedId)) return;
    setSelectedId(rows[0]?.id ?? null);
    setAction(null);
  }, [rows, selectedId]);

  if (!shopId) {
    return (
      <PageScaffold
        eyebrow="Orders"
        title="Orders"
        description="Select a concrete shop to supervise canonical order lifecycle and refunds."
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
      description="Search immutable order context, then perform controlled cancellation, refund or return actions."
    >
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
            <option value="ACTIVE">ACTIVE</option>
            <option value="DONE">DONE</option>
            <option value="CANCELLED">CANCELLED</option>
            <option value="RETURNED">RETURNED</option>
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
            <option value="ONLINE">ONLINE</option>
          </select>
        </label>
      </section>

      {actionError ? <p role="alert">{actionError}</p> : null}

      <div className="admin-inventory-layout">
        <section className="admin-inventory-list" aria-label="Orders">
          {ordersApi.searchQuery.isLoading ? <p>Loading orders…</p> : null}
          {ordersApi.searchQuery.isError ? <p role="alert">Orders could not be loaded.</p> : null}
          {rows.length === 0 && !ordersApi.searchQuery.isLoading ? (
            <div className="admin-empty-state">
              <strong>No matching orders</strong>
              <span>Adjust the search or filters for this shop.</span>
            </div>
          ) : null}
          {rows.map((row) => (
            <button
              className={
                row.id === selectedId ? 'admin-inventory-row is-selected' : 'admin-inventory-row'
              }
              key={row.id}
              type="button"
              onClick={() => {
                setSelectedId(row.id);
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
                {row.status} · {row.source}
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
        </section>

        <section className="admin-inventory-inspector">
          {ordersApi.detailQuery.isLoading ? <p>Loading order detail…</p> : null}
          {ordersApi.detailQuery.isError ? (
            <p role="alert">Order detail could not be loaded.</p>
          ) : null}
          {detail ? (
            <>
              <OrderDetailPage
                order={detail}
                canCancel={canCancel}
                canRefund={canRefund}
                cancelling={ordersApi.cancelOrder.isPending}
                refunding={ordersApi.refundOrder.isPending}
                returning={ordersApi.returnOrderItems.isPending}
                onCancel={() => setAction('cancel')}
                onRefund={() => setAction('refund-return')}
                onReturn={() => setAction('refund-return')}
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
              {action === 'refund-return' ? (
                <RefundReturnPage
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
          ) : !ordersApi.detailQuery.isLoading ? (
            <div className="admin-empty-state">
              <strong>Select an order</strong>
              <span>
                Review immutable payment, customer, delivery, inventory, status and audit context.
              </span>
            </div>
          ) : null}
        </section>
      </div>
    </PageScaffold>
  );
}
