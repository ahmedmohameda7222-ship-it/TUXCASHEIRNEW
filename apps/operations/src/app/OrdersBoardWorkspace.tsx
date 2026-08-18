import { renderOrderReceiptHtml } from '@tux/printing';
import { orderLifecycle, type OrderId, type OrderSnapshot, type OrderStatus } from '@tux/domain';
import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { OperationsOrdersBoardClient, OperationsOrdersClient } from './sessionClient';

type BoardTab = OrderStatus;

const TABS: readonly { status: BoardTab; label: string }[] = [
  { status: 'ACTIVE', label: 'Active' },
  { status: 'DONE', label: 'Done' },
  { status: 'CANCELLED', label: 'Cancelled' },
  { status: 'RETURNED', label: 'Returned' },
];

function money(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const value = Math.abs(minor);
  return `${sign}E£${Math.floor(value / 100).toLocaleString()}${value % 100 === 0 ? '' : `.${String(value % 100).padStart(2, '0')}`}`;
}

function ageLabel(createdAt: string, nowMs: number): string {
  const minutes = Math.max(0, Math.floor((nowMs - Date.parse(createdAt)) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours} hr` : `${hours}h ${remainder}m`;
}

function timeLabel(createdAt: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(
    new Date(createdAt),
  );
}

function productConfiguration(order: OrderSnapshot): ReactNode {
  return order.items.map((item) => (
    <li key={item.id}>
      <div className="board-item-line">
        <strong>{item.quantity}×</strong>
        <span>{item.productName}</span>
      </div>
      {item.modifiers.length > 0 ? (
        <p>
          {item.modifiers.map((modifier) => `${modifier.quantity}× ${modifier.label}`).join(' · ')}
        </p>
      ) : null}
      {item.comboBeverages.length > 0 ? (
        <p>{item.comboBeverages.map((beverage) => beverage.label).join(' · ')}</p>
      ) : null}
      {item.itemNote === null ? null : <p className="board-note">Item note: {item.itemNote}</p>}
    </li>
  ));
}

function orderNoMatches(order: OrderSnapshot, query: string): boolean {
  const normalized = query.trim().replace(/^#/, '');
  return normalized.length === 0 || String(order.displayOrderNo).includes(normalized);
}

function DetailsDrawer({
  order,
  busy,
  onClose,
  onMarkDone,
  onCancel,
  onReturn,
  onReprint,
}: {
  readonly order: OrderSnapshot;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onMarkDone: (order: OrderSnapshot) => Promise<void>;
  readonly onCancel: (order: OrderSnapshot) => void;
  readonly onReturn: (order: OrderSnapshot) => void;
  readonly onReprint: (orderId: OrderId) => Promise<void>;
}) {
  const [receiptPreview, setReceiptPreview] = useState(false);
  const lifecycle = orderLifecycle(order);
  const cancellation = lifecycle.cancellation;
  const returned = lifecycle.returned;
  return (
    <div className="board-drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside
        className="board-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="board-details-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="board-drawer-heading">
          <div>
            <p className="eyebrow">{order.status}</p>
            <h2 id="board-details-title">Order #{order.displayOrderNo}</h2>
            <p>
              {order.fulfillment.orderTypeLabel} · {timeLabel(order.createdAt)}
            </p>
          </div>
          <button type="button" className="board-quiet-button" onClick={onClose}>
            Close
          </button>
        </header>

        <section className="board-detail-section">
          <h3>Items</h3>
          <ul className="board-items board-items-detailed">{productConfiguration(order)}</ul>
          {order.orderNote === null ? null : (
            <p className="board-note">Order note: {order.orderNote}</p>
          )}
        </section>

        {order.fulfillment.behavior === 'DELIVERY' ? (
          <section className="board-detail-section">
            <h3>Delivery</h3>
            <dl className="board-detail-grid">
              <dt>Customer</dt>
              <dd>{order.fulfillment.delivery.customerName}</dd>
              <dt>Phone</dt>
              <dd>{order.fulfillment.delivery.normalizedPhone}</dd>
              <dt>Zone</dt>
              <dd>{order.fulfillment.delivery.zoneLabel}</dd>
              <dt>Address</dt>
              <dd>{order.fulfillment.delivery.address}</dd>
              <dt>Delivery fee</dt>
              <dd>{money(order.deliveryFeeMinor)}</dd>
            </dl>
          </section>
        ) : null}

        <section className="board-detail-section">
          <h3>Payment</h3>
          <dl className="board-detail-grid">
            {order.payments.map((payment) => (
              <div className="board-detail-pair" key={payment.id}>
                <dt>{payment.method.label}</dt>
                <dd>{money(payment.allocatedMinor)}</dd>
              </div>
            ))}
            <dt>Total</dt>
            <dd>
              <strong>{money(order.totalMinor)}</strong>
            </dd>
            <dt>Worker</dt>
            <dd>{order.operatorName}</dd>
          </dl>
        </section>

        {cancellation === null ? null : (
          <section className="board-detail-section board-exception-detail">
            <h3>Cancellation</h3>
            <p>{cancellation.reason}</p>
            <p>
              {cancellation.foodPrepared
                ? "Food was prepared · stock wasn't restored"
                : 'Food was not prepared · stock restored'}
            </p>
            <p>
              By {cancellation.workerName} · {timeLabel(cancellation.at)}
            </p>
          </section>
        )}

        {returned === null ? null : (
          <section className="board-detail-section board-exception-detail">
            <h3>Delivery Failed</h3>
            <p>{returned.reason}</p>
            <dl className="board-detail-grid">
              <dt>Historical order total</dt>
              <dd>{money(order.totalMinor)}</dd>
              <dt>Recognized revenue</dt>
              <dd>E£0</dd>
              <dt>Payment collected</dt>
              <dd>E£0</dd>
              <dt>Inventory restored</dt>
              <dd>No</dd>
            </dl>
          </section>
        )}

        <section className="board-detail-actions">
          <button
            type="button"
            className="board-secondary-button"
            onClick={() => setReceiptPreview((open) => !open)}
          >
            {receiptPreview ? 'Hide Receipt Preview' : 'Preview Receipt'}
          </button>
          {order.status === 'DONE' || order.status === 'RETURNED' ? (
            <button
              type="button"
              className="board-secondary-button"
              disabled={busy}
              onClick={() => void onReprint(order.id)}
            >
              Reprint
            </button>
          ) : null}
          {order.status === 'ACTIVE' ? (
            <>
              <button
                type="button"
                className="board-primary-button"
                disabled={busy}
                onClick={() => void onMarkDone(order)}
              >
                Mark Done
              </button>
              <button
                type="button"
                className="board-danger-button"
                disabled={busy}
                onClick={() => onCancel(order)}
              >
                Cancel
              </button>
            </>
          ) : null}
          {order.status === 'DONE' && order.fulfillment.behavior === 'DELIVERY' ? (
            <button
              type="button"
              className="board-danger-button"
              disabled={busy}
              onClick={() => onReturn(order)}
            >
              Delivery Failed
            </button>
          ) : null}
        </section>

        {receiptPreview ? (
          <iframe
            className="board-receipt-preview"
            title={`Receipt preview for order ${order.displayOrderNo}`}
            sandbox=""
            srcDoc={renderOrderReceiptHtml(order)}
          />
        ) : null}
      </aside>
    </div>
  );
}

function CancelDialog({
  order,
  busy,
  onClose,
  onConfirm,
}: {
  readonly order: OrderSnapshot;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onConfirm: (foodPrepared: boolean, reason: string) => Promise<void>;
}) {
  const [foodPrepared, setFoodPrepared] = useState<boolean | null>(null);
  const [reason, setReason] = useState('');
  return (
    <div className="modal-backdrop">
      <section
        className="board-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-order-title"
      >
        <header>
          <div>
            <p className="eyebrow">Cancel order</p>
            <h2 id="cancel-order-title">Order #{order.displayOrderNo}</h2>
          </div>
          <button className="board-quiet-button" type="button" onClick={onClose}>
            Close
          </button>
        </header>
        <fieldset>
          <legend>Was food already prepared?</legend>
          <div className="board-choice-row">
            <button
              className={foodPrepared === false ? 'board-choice active' : 'board-choice'}
              type="button"
              onClick={() => setFoodPrepared(false)}
            >
              No · Restore Stock
            </button>
            <button
              className={foodPrepared === true ? 'board-choice active' : 'board-choice'}
              type="button"
              onClick={() => setFoodPrepared(true)}
            >
              Yes · Don’t Restore Stock
            </button>
          </div>
        </fieldset>
        <label>
          Reason
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={240}
          />
        </label>
        <button
          className="board-danger-button"
          type="button"
          disabled={busy || foodPrepared === null || reason.trim().length === 0}
          onClick={() => {
            if (foodPrepared !== null) void onConfirm(foodPrepared, reason);
          }}
        >
          Confirm Cancellation
        </button>
      </section>
    </div>
  );
}

function ReturnDialog({
  order,
  busy,
  onClose,
  onConfirm,
}: {
  readonly order: OrderSnapshot;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  return (
    <div className="modal-backdrop">
      <section
        className="board-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="return-order-title"
      >
        <header>
          <div>
            <p className="eyebrow">Delivery Failed</p>
            <h2 id="return-order-title">Order #{order.displayOrderNo}</h2>
          </div>
          <button className="board-quiet-button" type="button" onClick={onClose}>
            Close
          </button>
        </header>
        <p>
          This records no collected payment, no recognized revenue, no inventory restoration, and
          creates the locked Delivery Failed expense event.
        </p>
        <label>
          Reason
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={240}
          />
        </label>
        <button
          className="board-danger-button"
          type="button"
          disabled={busy || reason.trim().length === 0}
          onClick={() => void onConfirm(reason)}
        >
          Confirm Delivery Failed
        </button>
      </section>
    </div>
  );
}

export function OrdersBoardWorkspace({
  client,
  ordersClient,
}: {
  readonly client: OperationsOrdersBoardClient;
  readonly ordersClient: OperationsOrdersClient;
}) {
  const [orders, setOrders] = useState<readonly OrderSnapshot[]>([]);
  const [tab, setTab] = useState<BoardTab>('ACTIVE');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [selected, setSelected] = useState<OrderSnapshot | null>(null);
  const [cancelTarget, setCancelTarget] = useState<OrderSnapshot | null>(null);
  const [returnTarget, setReturnTarget] = useState<OrderSnapshot | null>(null);
  const [undo, setUndo] = useState<{ orderId: OrderId; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    const result = await client.loadBoard();
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setOrders(result.value.orders);
    setError(null);
    setSelected((current) =>
      current === null
        ? null
        : (result.value.orders.find((order) => order.id === current.id) ?? null),
    );
  }

  useEffect(() => {
    void refresh();
  }, [client]);
  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);
  useEffect(() => {
    if (undo === null) return;
    const timeout = window.setTimeout(
      () => setUndo(null),
      Math.max(0, undo.expiresAt - Date.now()),
    );
    return () => window.clearTimeout(timeout);
  }, [undo]);

  const counts = useMemo(
    () =>
      Object.fromEntries(
        TABS.map(({ status }) => [
          status,
          orders.filter((order) => order.status === status).length,
        ]),
      ) as Record<BoardTab, number>,
    [orders],
  );
  const searching = deferredQuery.trim().length > 0;
  const visible = useMemo(() => {
    const matching = orders.filter((order) => orderNoMatches(order, deferredQuery));
    if (deferredQuery.trim().length > 0) {
      return [...matching].sort(
        (left, right) =>
          right.createdAt.localeCompare(left.createdAt) ||
          right.displayOrderNo - left.displayOrderNo,
      );
    }
    const filtered = matching.filter((order) => order.status === tab);
    return [...filtered].sort((left, right) =>
      tab === 'ACTIVE'
        ? left.createdAt.localeCompare(right.createdAt) ||
          left.displayOrderNo - right.displayOrderNo
        : right.createdAt.localeCompare(left.createdAt) ||
          right.displayOrderNo - left.displayOrderNo,
    );
  }, [orders, deferredQuery, tab]);

  async function mutate(
    action: () => ReturnType<OperationsOrdersBoardClient['markDone']>,
    success: string,
  ): Promise<boolean> {
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return false;
    }
    setOrders((current) =>
      current.map((order) => (order.id === result.value.id ? result.value : order)),
    );
    setSelected((current) => (current?.id === result.value.id ? result.value : current));
    setMessage(success);
    return true;
  }

  async function markDone(order: OrderSnapshot): Promise<void> {
    const changed = await mutate(
      () => client.markDone(order.id),
      `Order #${order.displayOrderNo} marked Done.`,
    );
    if (changed) {
      setSelected(null);
      setUndo({ orderId: order.id, expiresAt: Date.now() + 7_000 });
    }
  }

  async function undoDone(): Promise<void> {
    if (undo === null) return;
    const target = orders.find((order) => order.id === undo.orderId);
    const changed = await mutate(
      () => client.undoDone(undo.orderId),
      target === undefined
        ? 'Order returned to Active.'
        : `Order #${target.displayOrderNo} returned to Active.`,
    );
    if (changed) {
      setUndo(null);
      setTab('ACTIVE');
    }
  }

  async function reprint(orderId: OrderId): Promise<void> {
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await ordersClient.reprintOrder(orderId);
    setBusy(false);
    if (!result.ok) setError(result.error.message);
    else setMessage(`Receipt for order #${result.value.displayOrderNo} sent to print.`);
  }

  return (
    <main className="orders-board-shell">
      <header className="orders-board-toolbar">
        <div>
          <p className="eyebrow">Current Business Day</p>
          <h1>Orders Board</h1>
        </div>
        <label className="board-search">
          <span>Order #</span>
          <input
            type="search"
            inputMode="numeric"
            placeholder="Search order #"
            value={query}
            onChange={(event) => setQuery(event.target.value.replace(/[^0-9#]/g, ''))}
          />
        </label>
      </header>

      <div className="board-tabs" role="tablist" aria-label="Order status">
        {TABS.map(({ status, label }) => (
          <button
            key={status}
            type="button"
            role="tab"
            aria-selected={tab === status}
            className={tab === status ? 'board-tab active' : 'board-tab'}
            onClick={() => setTab(status)}
          >
            {label} <span>{counts[status]}</span>
          </button>
        ))}
      </div>

      {error === null ? null : (
        <div className="board-inline-error" role="alert">
          {error}
        </div>
      )}
      {message === null ? null : (
        <div className="board-inline-message" role="status">
          {message}
        </div>
      )}

      {visible.length === 0 ? (
        <section className="board-empty">
          <h2>{searching ? 'No matching order' : `No ${tab.toLowerCase()} orders`}</h2>
          <p>
            {searching
              ? 'No current Business Day order matches that order number.'
              : 'This current Business Day view is clear.'}
          </p>
        </section>
      ) : !searching && tab === 'ACTIVE' ? (
        <section className="active-order-grid" aria-label="Active orders">
          {visible.map((order) => (
            <article className="active-order-card" key={order.id}>
              <button className="active-card-main" type="button" onClick={() => setSelected(order)}>
                <header>
                  <div>
                    <strong>#{order.displayOrderNo}</strong>
                    <span>{order.fulfillment.orderTypeLabel}</span>
                  </div>
                  <time>{ageLabel(order.createdAt, nowMs)}</time>
                </header>
                {order.fulfillment.behavior === 'DELIVERY' ? (
                  <div className="delivery-card-meta">
                    <strong>{order.fulfillment.delivery.customerName}</strong>
                    <span>{order.fulfillment.delivery.zoneLabel}</span>
                  </div>
                ) : null}
                <ul className="board-items">{productConfiguration(order)}</ul>
                {order.orderNote === null ? null : (
                  <p className="board-note">Order note: {order.orderNote}</p>
                )}
              </button>
              <div className="active-card-actions">
                <button
                  type="button"
                  className="board-primary-button"
                  disabled={busy}
                  onClick={() => void markDone(order)}
                >
                  Mark Done
                </button>
                <button
                  type="button"
                  className="board-quiet-button"
                  disabled={busy}
                  onClick={() => setCancelTarget(order)}
                >
                  Cancel
                </button>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="board-history" aria-label={`${tab} orders`}>
          {visible.map((order) => (
            <button
              className="history-row"
              key={order.id}
              type="button"
              onClick={() => setSelected(order)}
            >
              <strong>#{order.displayOrderNo}</strong>
              <span>
                {searching
                  ? `${order.status} · ${order.fulfillment.orderTypeLabel}`
                  : order.fulfillment.orderTypeLabel}
              </span>
              <span>{money(order.totalMinor)}</span>
              <time>{timeLabel(order.createdAt)}</time>
              <span>{order.operatorName}</span>
              <span aria-hidden="true">›</span>
            </button>
          ))}
        </section>
      )}

      {undo === null ? null : (
        <div className="board-undo-toast" role="status">
          <span>Order marked Done.</span>
          <button type="button" disabled={busy} onClick={() => void undoDone()}>
            Undo
          </button>
        </div>
      )}
      {selected === null ? null : (
        <DetailsDrawer
          order={selected}
          busy={busy}
          onClose={() => setSelected(null)}
          onMarkDone={markDone}
          onCancel={(order) => setCancelTarget(order)}
          onReturn={(order) => setReturnTarget(order)}
          onReprint={reprint}
        />
      )}
      {cancelTarget === null ? null : (
        <CancelDialog
          order={cancelTarget}
          busy={busy}
          onClose={() => setCancelTarget(null)}
          onConfirm={async (foodPrepared, reason) => {
            const changed = await mutate(
              () => client.cancelOrder({ orderId: cancelTarget.id, foodPrepared, reason }),
              `Order #${cancelTarget.displayOrderNo} cancelled.`,
            );
            if (changed) {
              setCancelTarget(null);
              setSelected(null);
              setTab('CANCELLED');
            }
          }}
        />
      )}
      {returnTarget === null ? null : (
        <ReturnDialog
          order={returnTarget}
          busy={busy}
          onClose={() => setReturnTarget(null)}
          onConfirm={async (reason) => {
            const changed = await mutate(
              () => client.returnDelivery({ orderId: returnTarget.id, reason }),
              `Order #${returnTarget.displayOrderNo} marked Delivery Failed.`,
            );
            if (changed) {
              setReturnTarget(null);
              setSelected(null);
              setTab('RETURNED');
            }
          }}
        />
      )}
    </main>
  );
}
