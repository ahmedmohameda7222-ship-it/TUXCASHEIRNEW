import type { AdminInventoryMovement } from '@tux/admin-contracts';
import type { ReactNode } from 'react';

export type InventoryItemPageItem = {
  id: string;
  name: string;
  unitLabel: string;
  trackingMode: string;
  active: boolean;
  onHandMicros: number;
  reservedMicros: number;
  availableMicros: number;
  weightedUnitCostMinor: number;
  history?: readonly AdminInventoryMovement[];
};

export function formatInventoryQuantity(micros: number, unitLabel: string): string {
  const value = micros / 1_000_000;
  return `${new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 3,
  }).format(value)} ${unitLabel}`;
}

function movementLabel(value: string): string {
  return value.replaceAll('_', ' ');
}

export function InventoryItemPage({
  item,
  actions,
}: {
  item: InventoryItemPageItem;
  actions?: ReactNode;
}) {
  return (
    <section className="admin-inventory-item" aria-labelledby="inventory-item-title">
      <header className="admin-inventory-item__header">
        <div>
          <p className="admin-page__eyebrow">Inventory item</p>
          <h2 id="inventory-item-title">{item.name}</h2>
          <span className="admin-inventory-muted">
            {item.active ? 'Current stock position' : 'Archived inventory item'}
          </span>
        </div>
        {actions ? <div className="admin-inventory-actions">{actions}</div> : null}
      </header>

      <dl className="inventory-balance-grid">
        <div>
          <dt>On Hand</dt>
          <dd>{formatInventoryQuantity(item.onHandMicros, item.unitLabel)}</dd>
        </div>
        <div>
          <dt>Reserved</dt>
          <dd>{formatInventoryQuantity(item.reservedMicros, item.unitLabel)}</dd>
        </div>
        <div>
          <dt>Available</dt>
          <dd>{formatInventoryQuantity(item.availableMicros, item.unitLabel)}</dd>
        </div>
      </dl>

      <section className="admin-inventory-history" aria-label="Inventory history">
        <div className="admin-inventory-history__header">
          <h3>History</h3>
          <span>Immutable ledger</span>
        </div>
        {(item.history ?? []).length === 0 ? (
          <p className="admin-inventory-muted">No movements recorded for this item yet.</p>
        ) : (
          <div className="admin-inventory-history__list">
            {(item.history ?? []).map((movement) => (
              <article key={movement.id} className="admin-inventory-history__row">
                <div>
                  <strong>{movementLabel(movement.movementType)}</strong>
                  {movement.reasonLabel ? <span>{movement.reasonLabel}</span> : null}
                </div>
                <div>
                  <span>
                    {formatInventoryQuantity(movement.quantityDeltaMicros, item.unitLabel)}
                  </span>
                  {movement.reservedDeltaMicros !== 0 ? (
                    <small>
                      Reserved{' '}
                      {formatInventoryQuantity(movement.reservedDeltaMicros, item.unitLabel)}
                    </small>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
