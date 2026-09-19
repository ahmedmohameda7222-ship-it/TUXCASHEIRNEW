import type { AdminInventoryItem, AdminInventoryTransfer } from '@tux/admin-contracts';
import { useMemo, useState } from 'react';

function formatQuantity(micros: number, unitLabel: string): string {
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(
    micros / 1_000_000,
  )} ${unitLabel}`;
}

function positiveMicros(value: string): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const micros = Math.round(numeric * 1_000_000);
  return Number.isSafeInteger(micros) && micros > 0 ? micros : null;
}

export function TransferPage({
  shopId,
  shopIds,
  items,
  transfers,
  sending,
  receiving,
  onBack,
  onSend,
  onReceive,
}: {
  shopId: string;
  shopIds: readonly string[];
  items: readonly AdminInventoryItem[];
  transfers: readonly AdminInventoryTransfer[];
  sending: boolean;
  receiving: boolean;
  onBack(): void;
  onSend(input: {
    destinationShopId: string;
    lines: readonly { inventoryItemId: string; quantityMicros: number }[];
  }): void;
  onReceive(transferId: string): void;
}) {
  const destinations = useMemo(() => shopIds.filter((candidate) => candidate !== shopId), [shopId, shopIds]);
  const incoming = useMemo(
    () =>
      transfers.filter(
        (transfer) => transfer.destinationShopId === shopId && transfer.status === 'SENT',
      ),
    [shopId, transfers],
  );
  const [destinationShopId, setDestinationShopId] = useState(destinations[0] ?? '');
  const [itemId, setItemId] = useState(items[0]?.id ?? '');
  const [quantity, setQuantity] = useState('');
  const quantityMicros = positiveMicros(quantity);

  return (
    <section className="admin-inventory-workflow" aria-labelledby="inventory-transfer-title">
      <div className="admin-inventory-workflow__header">
        <div>
          <p className="admin-page__eyebrow">Inter-shop ledger</p>
          <h2 id="inventory-transfer-title">Transfer stock</h2>
        </div>
        <button className="admin-secondary-button" type="button" onClick={onBack}>
          Back to inventory
        </button>
      </div>

      <section className="admin-inventory-card">
        <h3>Incoming sent transfers</h3>
        {incoming.length === 0 ? (
          <p className="admin-inventory-muted">No sent transfers are waiting for this shop.</p>
        ) : (
          <div className="admin-inventory-transfer-list">
            {incoming.map((transfer) => (
              <article key={transfer.id} className="admin-inventory-transfer-row">
                <div>
                  {transfer.lines.map((line) => (
                    <span key={line.inventoryItemId}>
                      {formatQuantity(line.quantityMicros, line.unitLabel)} {line.itemName}
                    </span>
                  ))}
                </div>
                <button
                  className="admin-primary-button"
                  type="button"
                  disabled={receiving}
                  onClick={() => onReceive(transfer.id)}
                >
                  Receive transfer
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="admin-inventory-card">
        <h3>Send transfer</h3>
        {destinations.length === 0 ? (
          <p className="admin-inventory-muted">No other authorized shop is available.</p>
        ) : (
          <div className="admin-inventory-form-grid">
            <label className="admin-select-field">
              <span>Destination shop</span>
              <select
                value={destinationShopId}
                onChange={(event) => setDestinationShopId(event.target.value)}
              >
                {destinations.map((destination) => (
                  <option key={destination} value={destination}>
                    {destination}
                  </option>
                ))}
              </select>
            </label>
            <label className="admin-select-field">
              <span>Inventory item</span>
              <select value={itemId} onChange={(event) => setItemId(event.target.value)}>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="admin-field">
              <span>Quantity</span>
              <input
                inputMode="decimal"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </label>
            <button
              className="admin-primary-button"
              type="button"
              disabled={
                sending ||
                destinationShopId.length === 0 ||
                itemId.length === 0 ||
                quantityMicros === null
              }
              onClick={() => {
                if (quantityMicros === null) return;
                onSend({
                  destinationShopId,
                  lines: [{ inventoryItemId: itemId, quantityMicros }],
                });
              }}
            >
              Send transfer
            </button>
          </div>
        )}
      </section>
    </section>
  );
}
