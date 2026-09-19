import type { AdminInventoryItem, AdminStocktakeSnapshot } from '@tux/admin-contracts';
import { useMemo, useState } from 'react';

function formatQuantity(micros: number, unitLabel: string): string {
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(
    micros / 1_000_000,
  )} ${unitLabel}`;
}

function toMicros(value: string): number | null {
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
  const initial = useMemo(
    () =>
      Object.fromEntries(
        snapshot.lines.map((line) => [
          line.inventoryItemId,
          String(line.snapshotOnHandMicros / 1_000_000),
        ]),
      ),
    [snapshot],
  );
  const [actualByItem, setActualByItem] = useState<Record<string, string>>(initial);

  const parsed = snapshot.lines.map((line) => ({
    line,
    item: itemById.get(line.inventoryItemId),
    actualMicros: toMicros(actualByItem[line.inventoryItemId] ?? ''),
  }));
  const valid = parsed.every((entry) => entry.item && entry.actualMicros !== null);

  return (
    <section className="admin-inventory-workflow" aria-labelledby="inventory-stocktake-title">
      <div className="admin-inventory-workflow__header">
        <div>
          <p className="admin-page__eyebrow">Frozen count boundary</p>
          <h2 id="inventory-stocktake-title">Stock count</h2>
        </div>
        <button className="admin-secondary-button" type="button" onClick={onBack}>
          Back to inventory
        </button>
      </div>

      <div className="admin-inventory-policy-grid">
        <div>
          <span>Count boundary</span>
          <strong>Captured before counting</strong>
        </div>
        <div>
          <span>Concurrent movements</span>
          <strong>Preserved after the snapshot</strong>
        </div>
      </div>

      <div className="admin-inventory-stocktake-list">
        {parsed.map(({ line, item, actualMicros }) => {
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
                  <dt>Snapshot on hand</dt>
                  <dd>{formatQuantity(line.snapshotOnHandMicros, item.unitLabel)}</dd>
                </div>
                <div>
                  <dt>Snapshot reserved</dt>
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
                <span>Quantity variance</span>
                <strong>
                  {variance === null ? '—' : formatQuantity(variance, item.unitLabel)}
                </strong>
                <span>Value variance</span>
                <strong>
                  {valueVariance === null
                    ? '—'
                    : new Intl.NumberFormat('en-US', {
                        maximumFractionDigits: 2,
                      }).format(valueVariance)}
                </strong>
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
