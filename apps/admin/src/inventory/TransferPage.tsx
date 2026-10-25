import type { AdminInventoryItem, AdminInventoryTransfer } from '@tux/admin-contracts';
import { useMemo, useState } from 'react';

import { parsePurchaseDecimalMicros } from '../purchasing/purchaseOrderDraft';

function formatQuantity(micros: number, unitLabel: string): string {
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(micros / 1_000_000)} ${unitLabel}`;
}

type TransferDraftLine = { inventoryItemId: string; quantityMicros: number };

export function TransferPage({
  shopId,
  shops,
  items,
  transfers,
  sending,
  receiving,
  cancelling,
  onBack,
  onSend,
  onReceive,
  onCancelTransfer,
}: {
  shopId: string;
  shops: readonly { id: string; name: string }[];
  items: readonly AdminInventoryItem[];
  transfers: readonly AdminInventoryTransfer[];
  sending: boolean;
  receiving: boolean;
  cancelling: boolean;
  onBack(): void;
  onSend(input: { destinationShopId: string; lines: readonly TransferDraftLine[] }): void;
  onReceive(transferId: string): void;
  onCancelTransfer(transferId: string): void;
}) {
  const destinations = useMemo(() => shops.filter((shop) => shop.id !== shopId), [shopId, shops]);
  const shopNames = useMemo(() => new Map(shops.map((shop) => [shop.id, shop.name])), [shops]);
  const incoming = useMemo(
    () => transfers.filter((t) => t.destinationShopId === shopId && t.status === 'SENT'),
    [shopId, transfers],
  );
  const outgoing = useMemo(
    () => transfers.filter((t) => t.sourceShopId === shopId),
    [shopId, transfers],
  );
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const transferableItems = useMemo(() => items.filter((item) => item.active), [items]);
  const [destinationShopId, setDestinationShopId] = useState(destinations[0]?.id ?? '');
  const [itemId, setItemId] = useState(transferableItems[0]?.id ?? '');
  const [quantity, setQuantity] = useState('');
  const [draftLines, setDraftLines] = useState<TransferDraftLine[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedDestinationShopId = destinations.some((shop) => shop.id === destinationShopId)
    ? destinationShopId
    : (destinations[0]?.id ?? '');
  const selectedItemId = transferableItems.some((item) => item.id === itemId)
    ? itemId
    : (transferableItems[0]?.id ?? '');
  const quantityMicros = parsePurchaseDecimalMicros(quantity);

  function addLine() {
    const item = itemById.get(selectedItemId);
    if (!item || !item.active || quantityMicros === null || quantityMicros > item.availableMicros) {
      setError('Enter a valid positive quantity not exceeding the currently available stock.');
      return;
    }
    if (draftLines.some((line) => line.inventoryItemId === item.id)) {
      setError('This inventory item is already in the transfer. Remove it to change the quantity.');
      return;
    }
    setDraftLines((lines) => [...lines, { inventoryItemId: item.id, quantityMicros }]);
    setQuantity('');
    setError(null);
    setReviewing(false);
  }

  return (
    <section className="admin-inventory-workflow" aria-labelledby="inventory-transfer-title">
      <div className="admin-inventory-workflow__header">
        <div>
          <p className="admin-page__eyebrow">Move stock between shops</p>
          <h2 id="inventory-transfer-title">Transfer stock</h2>
        </div>
        <button className="admin-secondary-button" type="button" onClick={onBack}>
          Back to inventory
        </button>
      </div>

      <section className="admin-inventory-card" aria-label="Pending incoming transfers">
        <h3>Incoming sent transfers</h3>
        {incoming.length === 0 ? (
          <p className="admin-inventory-muted">No sent transfers are waiting for this shop.</p>
        ) : (
          <div className="admin-inventory-transfer-list">
            {incoming.map((transfer) => (
              <article key={transfer.id} className="admin-inventory-transfer-row">
                <div>
                  <strong>
                    From {shopNames.get(transfer.sourceShopId) ?? 'authorized source shop'}
                  </strong>
                  <small>Status: Sent · {new Date(transfer.sentAt).toLocaleString('en-GB')}</small>
                  {transfer.lines.map((line) => (
                    <span key={line.inventoryItemId}>
                      {formatQuantity(line.quantityMicros, line.unitLabel)} {line.itemName}
                    </span>
                  ))}
                </div>
                <button
                  className="admin-primary-button"
                  type="button"
                  disabled={receiving || cancelling}
                  onClick={() => onReceive(transfer.id)}
                >
                  Receive transfer
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="admin-inventory-card" aria-label="Outgoing transfer history">
        <h3>Outgoing transfers</h3>
        {outgoing.length === 0 ? (
          <p className="admin-inventory-muted">No outgoing transfers recorded for this shop.</p>
        ) : (
          <div className="admin-inventory-transfer-list">
            {outgoing.map((transfer) => (
              <article key={transfer.id} className="admin-inventory-transfer-row">
                <div>
                  <strong>
                    To {shopNames.get(transfer.destinationShopId) ?? 'authorized destination shop'}
                  </strong>
                  <small>
                    Status: {transfer.status} · Sent{' '}
                    {new Date(transfer.sentAt).toLocaleString('en-GB')}
                  </small>
                  {transfer.receivedAt ? (
                    <small>Received {new Date(transfer.receivedAt).toLocaleString('en-GB')}</small>
                  ) : null}
                  {transfer.lines.map((line) => (
                    <span key={line.inventoryItemId}>
                      {formatQuantity(line.quantityMicros, line.unitLabel)} {line.itemName}
                    </span>
                  ))}
                </div>
                {transfer.status === 'SENT' ? (
                  <div>
                    {cancelConfirmId === transfer.id ? (
                      <>
                        <p className="admin-inventory-muted">
                          Cancel only if the destination has not received this transfer. The source
                          ledger will be compensated.
                        </p>
                        <button
                          className="admin-secondary-button"
                          type="button"
                          disabled={cancelling || receiving}
                          onClick={() => setCancelConfirmId(null)}
                        >
                          Keep sent
                        </button>
                        <button
                          className="admin-danger-button"
                          type="button"
                          disabled={cancelling || receiving}
                          onClick={() => {
                            onCancelTransfer(transfer.id);
                            setCancelConfirmId(null);
                          }}
                        >
                          Confirm cancellation
                        </button>
                      </>
                    ) : (
                      <button
                        className="admin-secondary-button"
                        type="button"
                        disabled={cancelling}
                        onClick={() => setCancelConfirmId(transfer.id)}
                      >
                        Cancel sent transfer
                      </button>
                    )}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="admin-inventory-card">
        <h3>Send transfer</h3>
        <p className="admin-inventory-muted">
          Source and destination must be bound to the same authorized recipe master item, with
          matching base unit and tracking mode. A matching item name alone is not sufficient.
        </p>
        {destinations.length === 0 ? (
          <p className="admin-inventory-muted">No other authorized shop is available.</p>
        ) : (
          <div className="admin-inventory-form-grid">
            <label className="admin-select-field">
              <span>Destination shop</span>
              <select
                value={selectedDestinationShopId}
                onChange={(event) => {
                  setDestinationShopId(event.currentTarget.value);
                  setDraftLines([]);
                  setReviewing(false);
                  setError(null);
                }}
              >
                {destinations.map((shop) => (
                  <option key={shop.id} value={shop.id}>
                    {shop.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="admin-select-field">
              <span>Inventory item</span>
              <select
                value={selectedItemId}
                onChange={(event) => {
                  setItemId(event.currentTarget.value);
                  setError(null);
                }}
              >
                {transferableItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="admin-field">
              <span>Quantity (base units)</span>
              <input
                inputMode="decimal"
                value={quantity}
                onChange={(event) => setQuantity(event.currentTarget.value)}
              />
            </label>
            {selectedItemId ? (
              <p className="admin-inventory-muted">
                Available:{' '}
                {formatQuantity(
                  itemById.get(selectedItemId)?.availableMicros ?? 0,
                  itemById.get(selectedItemId)?.unitLabel ?? '',
                )}
              </p>
            ) : null}
            {error ? <p role="alert">{error}</p> : null}
            <button
              className="admin-secondary-button"
              type="button"
              disabled={
                sending || !selectedItemId || quantityMicros === null || draftLines.length >= 500
              }
              onClick={addLine}
            >
              Add to transfer
            </button>
            <div className="admin-inventory-transfer-draft">
              <h4>Draft items ({draftLines.length})</h4>
              {draftLines.length === 0 ? (
                <p className="admin-inventory-muted">Add at least one inventory item.</p>
              ) : null}
              {draftLines.map((line) => (
                <div key={line.inventoryItemId} className="admin-inventory-transfer-draft-row">
                  <span>
                    {itemById.get(line.inventoryItemId)?.name ?? 'Inventory item'} ·{' '}
                    {formatQuantity(
                      line.quantityMicros,
                      itemById.get(line.inventoryItemId)?.unitLabel ?? '',
                    )}
                  </span>
                  <button
                    className="admin-secondary-button"
                    type="button"
                    disabled={sending}
                    onClick={() => {
                      setDraftLines((lines) =>
                        lines.filter(
                          (candidate) => candidate.inventoryItemId !== line.inventoryItemId,
                        ),
                      );
                      setReviewing(false);
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            {!reviewing ? (
              <button
                className="admin-primary-button"
                type="button"
                disabled={sending || selectedDestinationShopId.length === 0 || draftLines.length === 0}
                onClick={() => setReviewing(true)}
              >
                Review transfer
              </button>
            ) : (
              <div className="admin-inventory-transfer-review">
                <h4>Confirm transfer</h4>
                <p>
                  From {shopNames.get(shopId)} to {shopNames.get(selectedDestinationShopId)}. Source
                  stock is deducted now; destination stock increases only when received.
                </p>
                <button
                  className="admin-secondary-button"
                  type="button"
                  disabled={sending}
                  onClick={() => setReviewing(false)}
                >
                  Edit draft
                </button>
                <button
                  className="admin-primary-button"
                  type="button"
                  disabled={sending}
                  onClick={() => {
                    if (!selectedDestinationShopId || draftLines.length === 0) return;
                    onSend({ destinationShopId: selectedDestinationShopId, lines: draftLines });
                  }}
                >
                  Confirm send
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    </section>
  );
}
