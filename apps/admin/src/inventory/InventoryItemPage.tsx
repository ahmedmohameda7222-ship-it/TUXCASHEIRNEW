import type { AdminInventoryMovement } from '@tux/admin-contracts';
import { useEffect, useState, type ReactNode } from 'react';

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
  lowStockThresholdMicros?: number | null;
  history?: readonly AdminInventoryMovement[];
};

export function formatInventoryMicros(micros: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: micros % 1_000 === 0 ? 3 : 6,
  }).format(micros / 1_000_000);
}

export function formatInventoryQuantity(micros: number, unitLabel: string): string {
  return `${formatInventoryMicros(micros)} ${unitLabel}`;
}

function movementLabel(value: string): string {
  return value
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/^./, (letter) => letter.toUpperCase());
}

function movementDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return date.toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Cairo',
  });
}

type InspectorTab = 'overview' | 'movements' | 'settings';

export function InventoryItemPage({
  item,
  actions,
  shopName,
  initialTab = 'overview',
}: {
  item: InventoryItemPageItem;
  actions?: ReactNode;
  shopName?: string | undefined;
  initialTab?: InspectorTab;
}) {
  const [tab, setTab] = useState<InspectorTab>(initialTab);
  useEffect(() => setTab(initialTab), [item.id, initialTab]);

  const tabs: readonly { key: InspectorTab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'movements', label: 'Stock & movements' },
    { key: 'settings', label: 'Settings' },
  ];

  const threshold = item.lowStockThresholdMicros;
  return (
    <section className="admin-inventory-item" aria-labelledby="inventory-item-title">
      <header className="admin-inventory-item__header">
        <div>
          <p className="admin-page__eyebrow">Inventory item</p>
          <h2 id="inventory-item-title">{item.name}</h2>
          <span className="admin-inventory-inspector-meta">
            <span
              className={
                item.active ? 'admin-inventory-item-active' : 'admin-inventory-item-inactive'
              }
            >
              {item.active ? 'Active' : 'Archived'}
            </span>
            {' · '}
            {item.unitLabel} ·{' '}
            {item.trackingMode === 'RECIPE_TRACKED' ? 'Recipe tracked' : 'Bulk / manual'}
            {shopName ? ` · ${shopName}` : ''}
          </span>
        </div>
        {actions ? <div className="admin-inventory-actions">{actions}</div> : null}
      </header>

      <div
        role="tablist"
        aria-label="Inventory item information"
        className="admin-inventory-inspector-tabs"
      >
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            id={`inventory-tab-${key}`}
            type="button"
            role="tab"
            aria-selected={tab === key}
            aria-controls={`inventory-panel-${key}`}
            tabIndex={tab === key ? 0 : -1}
            className={tab === key ? 'is-selected' : ''}
            onClick={() => setTab(key)}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const index = tabs.findIndex((entry) => entry.key === tab);
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? tabs.length - 1
                    : (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
              setTab(tabs[next]!.key);
              const buttons =
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                  '[role="tab"]',
                );
              buttons?.[next]?.focus();
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        <div
          role="tabpanel"
          id="inventory-panel-overview"
          aria-labelledby="inventory-tab-overview"
          className="admin-inventory-inspector-panel"
        >
          <dl className="inventory-balance-grid">
            <div>
              <dt>On hand</dt>
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
          <div className="admin-inventory-stock-threshold">
            <strong>Stock level</strong>
            <span>Available = On hand − Reserved</span>
            <dl>
              <div>
                <dt>Low-stock threshold</dt>
                <dd>
                  {threshold === null || threshold === undefined
                    ? 'Not configured'
                    : formatInventoryQuantity(threshold, item.unitLabel)}
                </dd>
              </div>
            </dl>
          </div>
          <dl className="admin-inventory-definition-overview">
            <div>
              <dt>Name</dt>
              <dd>{item.name}</dd>
            </div>
            <div>
              <dt>Base unit</dt>
              <dd>{item.unitLabel}</dd>
            </div>
            <div>
              <dt>Tracking mode</dt>
              <dd>{item.trackingMode === 'RECIPE_TRACKED' ? 'Recipe tracked' : 'Bulk / manual'}</dd>
            </div>
            <div>
              <dt>Availability</dt>
              <dd>{item.active ? 'Active' : 'Archived'}</dd>
            </div>
          </dl>
        </div>
      ) : null}
      {tab === 'movements' ? (
        <section
          role="tabpanel"
          id="inventory-panel-movements"
          aria-labelledby="inventory-tab-movements"
          className="admin-inventory-history"
        >
          <div className="admin-inventory-history__header">
            <h3>Stock & movements</h3>
            <span>Recent recorded movements</span>
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
                    <small>{movementDate(movement.createdAt)}</small>
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
      ) : null}
      {tab === 'settings' ? (
        <div
          role="tabpanel"
          id="inventory-panel-settings"
          aria-labelledby="inventory-tab-settings"
          className="admin-inventory-inspector-panel"
        >
          <dl className="admin-inventory-definition-overview">
            <div>
              <dt>Name</dt>
              <dd>{item.name}</dd>
            </div>
            <div>
              <dt>Base unit</dt>
              <dd>{item.unitLabel}</dd>
            </div>
            <div>
              <dt>Tracking mode</dt>
              <dd>{item.trackingMode === 'RECIPE_TRACKED' ? 'Recipe tracked' : 'Bulk / manual'}</dd>
            </div>
            <div>
              <dt>Low-stock threshold</dt>
              <dd>
                {threshold === null || threshold === undefined
                  ? 'Not configured'
                  : formatInventoryQuantity(threshold, item.unitLabel)}
              </dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{item.active ? 'Active' : 'Archived'}</dd>
            </div>
          </dl>
          <p className="admin-inventory-muted">
            Use Edit item to manage thresholds, base units, purchase-unit conversions and the
            archival lifecycle when authorized.
          </p>
        </div>
      ) : null}
    </section>
  );
}
