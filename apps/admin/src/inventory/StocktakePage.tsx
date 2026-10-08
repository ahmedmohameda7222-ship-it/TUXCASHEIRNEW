import type { AdminInventoryItem, AdminStocktakeSnapshot } from '@tux/admin-contracts';
import { useMemo, useState } from 'react';

function formatQuantity(micros: number, unitLabel: string): string {
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(
    micros / 1_000_000,
  )} ${unitLabel}`;
}

function toMicros(value: string): number | null {
  if (value.trim() === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  const micros = Math.round(numeric * 1_000_000);
  return Number.isSafeInteger(micros) && micros >= 0 ? micros : null;
}

export function StocktakePage({
  items,
  snapshot,
  pending,
  onBack,
  onSubmit,
}: {
  items: readonly AdminInventoryItem[];
  snapshot: AdminStocktakeSnapshot;
  pending: boolean;
  onBack(): void;
  onSubmit(lines: readonly { inventoryItemId: string; actualCountMicros: number }[]): void;
}) {
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const [actualByItem, setActualByItem] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');

  const parsed = snapshot.lines.map((line) => ({
    line,
    item: itemById.get(line.inventoryItemId),
    actualMicros: toMicros(actualByItem[line.inventoryItemId] ?? ''),
  }));
  const valid = parsed.every((entry) => entry.item && entry.actualMicros !== null);
  const counted = parsed.filter((entry) => entry.actualMicros !== null).length;
  const visible = parsed.filter((entry) =>
    entry.item?.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <section className="admin-inventory-workflow" aria-labelledby="inventory-stocktake-title">
      <div className="admin-inventory-workflow__header">
        <div>
          <p className="admin-page__eyebrow">Physical stock check</p>
          <h2 id="inventory-stocktake-title">Stock count</h2>
        </div>
        <button className="admin-secondary-button" type="button" onClick={onBack}>
          Back to inventory
        </button>
      </div>

      <div className="admin-inventory-policy-grid">
        <div>
          <span>Progress</span>
          <strong>
            {counted} / {parsed.length} counted
          </strong>
        </div>
        <div>
          <span>Expected quantities</span>
          <strong>Captured when this count started</strong>
        </div>
      </div>

      <label className="admin-field">
        <span>Search items</span>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
        />
      </label>

      <div className="admin-inventory-stocktake-list">
        {visible.map(({ line, item, actualMicros }) => {
          if (!item) return null;
          const variance = actualMicros === null ? null : actualMicros - line.snapshotOnHandMicros;
          const valueVariance =
            variance === null ? null : (variance / 1_000_000) * line.unitCostMinor;
          return (
            <article className="admin-inventory-stocktake-row" key={line.inventoryItemId}>
              <div className="admin-inventory-stocktake-row__title">
                <strong>{item.name}</strong>
                <span>{item.unitLabel}</span>
              </div>
              <dl>
                <div>
                  <dt>Expected stock</dt>
                  <dd>{formatQuantity(line.snapshotOnHandMicros, item.unitLabel)}</dd>
                </div>
                <div>
                  <dt>Reserved</dt>
                  <dd>{formatQuantity(line.snapshotReservedMicros, item.unitLabel)}</dd>
                </div>
              </dl>
              <label className="admin-field">
                <span>Actual count</span>
                <input
                  aria-label={`Actual count for ${item.name}`}
                  inputMode="decimal"
                  value={actualByItem[line.inventoryItemId] ?? ''}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setActualByItem((current) => ({
                      ...current,
                      [line.inventoryItemId]: value,
                    }));
                  }}
                />
              </label>
              <div className="admin-inventory-variance">
                <span>Difference</span>
                <strong>
                  {variance === null ? '—' : formatQuantity(variance, item.unitLabel)}
                </strong>
                <span>Estimated value difference</span>
                <strong>
                  {valueVariance === null
                    ? '—'
                    : `${new Intl.NumberFormat('en-US', {
                        maximumFractionDigits: 2,
                      }).format(valueVariance / 100)} EGP`}
                </strong>
                <span>Posting</span>
                <strong>Current stock movements remain preserved</strong>
              </div>
            </article>
          );
        })}
      </div>

      <button
        className="admin-primary-button"
        type="button"
        disabled={!valid || pending}
        onClick={() => {
          if (!valid) return;
          onSubmit(
            parsed.map(({ line, actualMicros }) => ({
              inventoryItemId: line.inventoryItemId,
              actualCountMicros: actualMicros ?? 0,
            })),
          );
        }}
      >
        Post stock count
      </button>
    </section>
  );
}
