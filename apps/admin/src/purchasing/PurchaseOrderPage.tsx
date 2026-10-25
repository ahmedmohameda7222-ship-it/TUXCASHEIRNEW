import './purchaseOrder.css';
import type {
  AdminPurchaseOrder,
  AdminPurchaseOrderHistory,
  AdminPurchasingInventoryItem,
} from '@tux/admin-contracts';
import { DraftPurchaseOrderLinesEditor } from './DraftPurchaseOrderLinesEditor';
import { formatPurchaseMicros } from './purchaseOrderDraft';
import {
  expectedOrderValueMinor,
  formatExpectedOrderValue,
  purchaseOrderDisplayReference,
} from './purchaseOrderValue';
import { useEffect, useState } from 'react';

function statusLabel(status: AdminPurchaseOrder['status']): string {
  return status
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/^./, (letter) => letter.toUpperCase());
}

export function PurchaseOrderPage({
  order,
  canManage,
  canReceive,
  ordering,
  updating,
  onUpdate,
  inventoryItems = [],
  history,
  historyPending = false,
  historyError = false,
  onRetryHistory,
  replacing = false,
  onReplaceLines,
  cancelling,
  onCancel,
  onOrder,
  onReceive,
  onReturn,
}: {
  order: AdminPurchaseOrder;
  canManage: boolean;
  canReceive: boolean;
  ordering: boolean;
  updating: boolean;
  inventoryItems?: readonly AdminPurchasingInventoryItem[];
  history?: AdminPurchaseOrderHistory | null;
  historyPending?: boolean;
  historyError?: boolean;
  onRetryHistory?(): void;
  replacing?: boolean;
  onReplaceLines?(
    lines: readonly {
      inventoryItemId: string;
      purchaseUnitLabel: string;
      orderedPurchaseUnitsMicros: number;
      expectedPurchaseUnitCostMinor: number;
    }[],
    onSuccess: () => void,
  ): void;
  onUpdate(
    input: { reference: string | null; expectedDeliveryDate: string | null },
    onSuccess: () => void,
  ): void;
  cancelling: boolean;
  onCancel(): void;
  onOrder(): void;
  onReceive(): void;
  onReturn(): void;
}) {
  const [editing, setEditing] = useState(false);
  const [activeTab, setActiveTab] = useState<
    'overview' | 'items' | 'receiving' | 'returns' | 'history'
  >('overview');
  const [editingLines, setEditingLines] = useState(false);
  const [reference, setReference] = useState(order.reference ?? '');
  const [expectedDate, setExpectedDate] = useState(order.expectedDeliveryDate ?? '');
  const [confirmCancel, setConfirmCancel] = useState(false);

  useEffect(() => {
    setEditing(false);
    setEditingLines(false);
    setConfirmCancel(false);
    setReference(order.reference ?? '');
    setExpectedDate(order.expectedDeliveryDate ?? '');
  }, [order.id, order.version, order.reference, order.expectedDeliveryDate]);

  const canReturn =
    canReceive &&
    (order.status === 'PARTIALLY_RECEIVED' || order.status === 'RECEIVED') &&
    order.lines.some((line) => line.receivedBaseMicros - line.returnedBaseMicros > 0);

  return (
    <section className="admin-card" aria-label="Purchase order detail">
      <div className="admin-purchasing-order-header">
        <div className="admin-purchasing-order-header__identity">
          <strong>{purchaseOrderDisplayReference(order)}</strong>
          <small>{order.supplierName}</small>
        </div>
        <strong>{statusLabel(order.status)}</strong>
      </div>
      <div
        className="admin-purchasing-inspector-tabs"
        role="tablist"
        aria-label="Purchase order sections"
      >
        {(['overview', 'items', 'receiving', 'returns', 'history'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            className={activeTab === tab ? 'is-active' : ''}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>
      {activeTab === 'overview' ? (
        <div className="admin-purchasing-detail-content" role="tabpanel">
          <dl className="admin-definition-grid admin-purchasing-overview">
            <div>
              <dt>PO date</dt>
              <dd>{order.createdAt.slice(0, 10)}</dd>
            </div>
            <div>
              <dt>Expected delivery</dt>
              <dd>{order.expectedDeliveryDate ?? 'Not set'}</dd>
            </div>
            <div>
              <dt>Supplier</dt>
              <dd>{order.supplierName}</dd>
            </div>
            <div>
              <dt>Expected order value</dt>
              <dd>{formatExpectedOrderValue(expectedOrderValueMinor(order.lines))}</dd>
            </div>
            <div>
              <dt>Line items</dt>
              <dd>{order.lines.length}</dd>
            </div>
            <div>
              <dt>Lines fully received</dt>
              <dd>
                {
                  order.lines.filter(
                    (line) => line.receivedPurchaseUnitsMicros >= line.orderedPurchaseUnitsMicros,
                  ).length
                }
              </dd>
            </div>
            <div>
              <dt>Lines with recorded returns</dt>
              <dd>{order.lines.filter((line) => line.returnedPurchaseUnitsMicros > 0).length}</dd>
            </div>
          </dl>
          {order.lines.length > 0 ? (
            <div className="admin-purchasing-progress">
              <h3>Receiving progress</h3>
              {order.lines.map((line) => {
                const fraction =
                  line.orderedBaseMicros > 0
                    ? Math.min(100, (line.receivedBaseMicros / line.orderedBaseMicros) * 100)
                    : 0;
                return (
                  <div key={line.id} className="admin-purchasing-progress-line">
                    <div>
                      <strong>{line.itemName}</strong>
                      <span>
                        {formatPurchaseMicros(line.remainingBaseMicros)} {line.unitLabel} remaining
                      </span>
                    </div>
                    <progress
                      value={fraction}
                      max={100}
                      aria-label={`${line.itemName} receiving progress`}
                    />
                  </div>
                );
              })}
            </div>
          ) : null}
          <p className="admin-purchasing-detail-hint">
            Quantities are kept in each item's purchase unit; different units are not summed.
          </p>
        </div>
      ) : null}
      {order.status === 'DRAFT' && canManage ? (
        editing ? (
          <form
            className="admin-form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              onUpdate(
                { reference: reference.trim() || null, expectedDeliveryDate: expectedDate || null },
                () => setEditing(false),
              );
            }}
          >
            <label>
              Reference
              <input
                value={reference}
                maxLength={240}
                onChange={(event) => setReference(event.currentTarget.value)}
              />
            </label>
            <label>
              Expected delivery
              <input
                type="date"
                value={expectedDate}
                onChange={(event) => setExpectedDate(event.currentTarget.value)}
              />
            </label>
            <div className="admin-purchasing-page-actions">
              <button className="admin-primary-button" type="submit" disabled={updating}>
                Save draft
              </button>
              <button
                className="admin-secondary-button"
                type="button"
                disabled={updating}
                onClick={() => setEditing(false)}
              >
                Cancel editing
              </button>
            </div>
          </form>
        ) : (
          <button className="admin-secondary-button" type="button" onClick={() => setEditing(true)}>
            Edit draft
          </button>
        )
      ) : null}
      {canManage && order.status === 'DRAFT' && onReplaceLines ? (
        editingLines ? (
          <DraftPurchaseOrderLinesEditor
            key={order.id + ':' + order.version}
            order={order}
            inventoryItems={inventoryItems}
            pending={replacing}
            onCancel={() => setEditingLines(false)}
            onSave={onReplaceLines}
          />
        ) : (
          <button
            className="admin-secondary-button"
            type="button"
            disabled={replacing}
            onClick={() => setEditingLines(true)}
          >
            Edit draft lines
          </button>
        )
      ) : null}
      {activeTab === 'items' ? (
        <div className="admin-purchasing-detail-content" role="tabpanel">
          {order.lines.length === 0 ? (
            <p>No line items recorded.</p>
          ) : (
            <div className="admin-purchasing-line-list">
              {order.lines.map((line) => (
                <article key={line.id} className="admin-purchasing-line-item">
                  <strong>{line.itemName}</strong>
                  <small>Purchase unit: {line.purchaseUnitLabel}</small>
                  <dl>
                    <div>
                      <dt>Ordered</dt>
                      <dd>{formatPurchaseMicros(line.orderedPurchaseUnitsMicros)}</dd>
                    </div>
                    <div>
                      <dt>Received</dt>
                      <dd>{formatPurchaseMicros(line.receivedPurchaseUnitsMicros)}</dd>
                    </div>
                    <div>
                      <dt>Remaining</dt>
                      <dd>
                        {formatPurchaseMicros(
                          Math.max(
                            0,
                            line.orderedPurchaseUnitsMicros - line.receivedPurchaseUnitsMicros,
                          ),
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Returned</dt>
                      <dd>{formatPurchaseMicros(line.returnedPurchaseUnitsMicros)}</dd>
                    </div>
                    <div>
                      <dt>Expected unit cost</dt>
                      <dd>{(line.expectedPurchaseUnitCostMinor / 100).toFixed(2)} EGP</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          )}
        </div>
      ) : null}
      {activeTab === 'receiving' ? (
        <div className="admin-purchasing-detail-content" role="tabpanel">
          <h3>Recorded receiving quantities</h3>
          {order.lines.length === 0 ? (
            <p>No receiving lines recorded.</p>
          ) : (
            order.lines.map((line) => (
              <p key={line.id}>
                {line.itemName}: {formatPurchaseMicros(line.receivedPurchaseUnitsMicros)} received /{' '}
                {formatPurchaseMicros(line.orderedPurchaseUnitsMicros)} ordered{' '}
                {line.purchaseUnitLabel}
              </p>
            ))
          )}
          <p className="admin-purchasing-detail-hint">
            Individual receipt events and actual costs are not exposed by the current workspace API.
          </p>
        </div>
      ) : null}
      {activeTab === 'returns' ? (
        <div className="admin-purchasing-detail-content" role="tabpanel">
          <h3>Recorded supplier returns</h3>
          {order.lines.length === 0 ? (
            <p>No returnable lines recorded.</p>
          ) : (
            order.lines.map((line) => (
              <p key={line.id}>
                {line.itemName}: {formatPurchaseMicros(line.returnedPurchaseUnitsMicros)} returned,{' '}
                {formatPurchaseMicros(
                  Math.max(0, line.receivedPurchaseUnitsMicros - line.returnedPurchaseUnitsMicros),
                )}{' '}
                remaining returnable {line.purchaseUnitLabel}
              </p>
            ))
          )}
        </div>
      ) : null}
      {activeTab === 'history' ? (
        <div className="admin-purchasing-detail-content" role="tabpanel">
          {historyPending ? <p role="status">Loading persisted purchase history…</p> : null}
          {historyError ? (
            <div role="alert">
              <p>Purchase history could not be loaded.</p>
              {onRetryHistory ? (
                <button type="button" className="admin-secondary-button" onClick={onRetryHistory}>
                  Retry history
                </button>
              ) : null}
            </div>
          ) : null}
          {!historyPending && !historyError && (!history || history.events.length === 0) ? (
            <p>No receipt or return event history is available for this purchase order.</p>
          ) : null}
          {!historyPending && !historyError && history ? (
            <ol className="admin-purchasing-history-list">
              {history.events.map((event) => (
                <li key={event.id} className="admin-purchasing-history-event">
                  <div className="admin-purchasing-history-event__header">
                    <strong>
                      {event.type === 'RECEIPT' ? 'Purchase received' : 'Supplier return'}
                    </strong>
                    <time dateTime={event.occurredAt}>
                      {new Date(event.occurredAt).toLocaleString()}
                    </time>
                  </div>
                  <small>Record {event.id}</small>
                  {event.supplierReference ? (
                    <p>Supplier reference: {event.supplierReference}</p>
                  ) : null}
                  <ul>
                    {event.lines.map((line) => {
                      const orderedLine = order.lines.find(
                        (candidate) => candidate.id === line.purchaseOrderLineId,
                      );
                      return (
                        <li key={line.purchaseOrderLineId}>
                          {orderedLine?.itemName ?? 'Inventory item'} —{' '}
                          {formatPurchaseMicros(line.quantityPurchaseUnitsMicros)}{' '}
                          {orderedLine?.purchaseUnitLabel ?? 'purchase units'}
                          {line.purchaseUnitCostMinor !== null ? (
                            <>
                              {' '}
                              · Actual cost per purchase unit:{' '}
                              {(line.purchaseUnitCostMinor / 100).toFixed(2)} EGP
                            </>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ol>
          ) : null}
          {history?.truncated ? (
            <p className="admin-purchasing-detail-hint">
              Recent history only: at most 100 receipts and 100 supplier returns are shown.
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="admin-purchasing-page-actions">
        {(order.status === 'DRAFT' || order.status === 'ORDERED') && canManage ? (
          confirmCancel ? (
            <div className="admin-form-grid">
              <strong>Cancel this purchase order?</strong>
              <span>Cancellation keeps purchase history and cannot be undone.</span>
              <button
                className="admin-secondary-button"
                type="button"
                disabled={cancelling}
                onClick={onCancel}
              >
                Confirm cancel purchase order
              </button>
              <button
                className="admin-secondary-button"
                type="button"
                disabled={cancelling}
                onClick={() => setConfirmCancel(false)}
              >
                Keep purchase order
              </button>
            </div>
          ) : (
            <button
              className="admin-secondary-button"
              type="button"
              disabled={cancelling}
              onClick={() => setConfirmCancel(true)}
            >
              Cancel purchase order
            </button>
          )
        ) : null}
        {order.status === 'DRAFT' && canManage ? (
          <button
            className="admin-primary-button"
            type="button"
            disabled={ordering}
            onClick={onOrder}
          >
            Mark ordered
          </button>
        ) : null}
        {(order.status === 'ORDERED' || order.status === 'PARTIALLY_RECEIVED') && canReceive ? (
          <button className="admin-primary-button" type="button" onClick={onReceive}>
            Receive purchase
          </button>
        ) : null}
        {canReturn ? (
          <button className="admin-secondary-button" type="button" onClick={onReturn}>
            Return purchase
          </button>
        ) : null}
      </div>
    </section>
  );
}
