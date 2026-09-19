import type { AdminInventoryItem } from '@tux/admin-contracts';
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
  pending,
  onBack,
  onSubmit,
}: {
  items: readonly AdminInventoryItem[];
  pending: boolean;
  onBack(): void;
  onSubmit(lines: readonly { inventoryItemId: string; actualCountMicros: number }[]): void;
}) {
  const initial = useMemo(
    () => Object.fromEntries(items.map((item) => [item.id, String(item.onHandMicros / 1_000_000)])),
    [items],
  );
  const [actualByItem, setActualByItem] = useState<Record<string, string>>(initial);

  const parsed = items.map((item) => ({
    item,
    actualMicros: toMicros(actualByItem[item.id] ?? ''),
  }));
  const valid = parsed.every((line) => line.actualMicros !== null);

  return (
    <section className="admin-inventory-workflow" aria-labelledby="inventory-stocktake-title">
      <div className="admin-inventory-workflow__header">
        <div>
          <p className="admin-page__eyebrow">Immutable count posting</p>
          <h2 id="inventory-stocktake-title">Stock count</h2>
        </div>
        <button className="admin-secondary-button" type="button" onClick={onBack}>
          Back to inventory
        </button>
      </div>

      <div className="admin-inventory-policy-grid">
        <div>
          <span>Recount state</span>
          <strong>Not required by current policy</strong>
        </div>
        <div>
          <span>Approval required</span>
          <strong>No — direct counted variance posting</strong>
        </div>
      </div>

      <div className="admin-inventory-stocktake-list">
        {parsed.map(({ item, actualMicros }) => {
          const variance = actualMicros === null ? null : actualMicros - item.onHandMicros;
          const valueVariance =
            variance === null ? null : (variance / 1_000_000) * item.weightedUnitCostMinor;
          return (
            <article className="admin-inventory-stocktake-row" key={item.id}>
              <div className="admin-inventory-stocktake-row__title">
                <strong>{item.name}</strong>
                <span>{item.unitLabel}</span>
              </div>
              <dl>
                <div>
                  <dt>Snapshot on hand</dt>
                  <dd>{formatQuantity(item.onHandMicros, item.unitLabel)}</dd>
                </div>
                <div>
                  <dt>Reserved</dt>
                  <dd>{formatQuantity(item.reservedMicros, item.unitLabel)}</dd>
                </div>
              </dl>
              <label className="admin-field">
                <span>Actual count</span>
                <input
                  aria-label={`Actual count for ${item.name}`}
                  inputMode="decimal"
                  value={actualByItem[item.id] ?? ''}
                  onChange={(event) =>
                    setActualByItem((current) => ({
                      ...current,
                      [item.id]: event.target.value,
                    }))
                  }
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
            parsed.map(({ item, actualMicros }) => ({
              inventoryItemId: item.id,
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
