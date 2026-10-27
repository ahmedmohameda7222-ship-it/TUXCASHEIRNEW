import type { AdminInventoryItem, AdminStocktakeSnapshot } from '@tux/admin-contracts';
import { useEffect, useMemo, useState } from 'react';

import { formatInventoryMicros, formatInventoryQuantity } from './InventoryItemPage';
import { parseStocktakeMicros } from './stocktakeQuantity';

const formatQuantity = formatInventoryQuantity;

type CountLine = { inventoryItemId: string; actualCountMicros: number | null };

export function StocktakePage({
  items,
  snapshot,
  pending,
  saving = false,
  stale = false,
  initialActualByItem,
  onBack,
  onSubmit,
  onSaveDraft,
  onCancelDraft,
}: {
  items: readonly AdminInventoryItem[];
  snapshot: AdminStocktakeSnapshot;
  pending: boolean;
  saving?: boolean;
  stale?: boolean;
  initialActualByItem?: Readonly<Record<string, number | null>>;
  onBack(): void;
  onSubmit(lines: readonly { inventoryItemId: string; actualCountMicros: number }[]): void;
  onSaveDraft?(lines: readonly CountLine[], onSaved: () => void): void;
  onCancelDraft?(): void;
}) {
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const initiallySaved = () =>
    Object.fromEntries(
      snapshot.lines.map((line) => [
        line.inventoryItemId,
        initialActualByItem?.[line.inventoryItemId] === null ||
        initialActualByItem?.[line.inventoryItemId] === undefined
          ? ''
          : formatInventoryMicros(initialActualByItem[line.inventoryItemId] ?? 0),
      ]),
    ) as Record<string, string>;
  const [actualByItem, setActualByItem] = useState<Record<string, string>>(initiallySaved);
  const [savedByItem, setSavedByItem] = useState<Record<string, string>>(initiallySaved);
  const [search, setSearch] = useState('');

  const parsed = snapshot.lines.map((line) => ({
    line,
    item: itemById.get(line.inventoryItemId),
    actualMicros: parseStocktakeMicros(actualByItem[line.inventoryItemId] ?? ''),
  }));
  const valid =
    parsed.length > 0 && parsed.every((entry) => entry.item && entry.actualMicros !== null);
  const invalidCount = parsed.some(({ line }) => {
    const raw = actualByItem[line.inventoryItemId] ?? '';
    return raw.trim().length > 0 && parseStocktakeMicros(raw) === null;
  });
  const changed = snapshot.lines.some(
    (line) =>
      (actualByItem[line.inventoryItemId] ?? '') !== (savedByItem[line.inventoryItemId] ?? ''),
  );
  const counted = parsed.filter((entry) => entry.actualMicros !== null).length;
  const visible = parsed.filter((entry) =>
    entry.item?.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  useEffect(() => {
    if (!changed || typeof window === 'undefined') return;
    const onUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [changed]);

  const leave = () => {
    if (
      changed &&
      !window.confirm(
        'Discard unsaved count values? The saved server draft remains available to resume.',
      )
    )
      return;
    onBack();
  };

  const draftLines = (): CountLine[] =>
    parsed.map(({ line, actualMicros }) => ({
      inventoryItemId: line.inventoryItemId,
      actualCountMicros: actualMicros,
    }));

  return (
    <section className="admin-inventory-workflow" aria-labelledby="inventory-stocktake-title">
      <div className="admin-inventory-workflow__header">
        <div>
          <p className="admin-page__eyebrow">Physical stock check · After shift only</p>
          <h2 id="inventory-stocktake-title">Stock count</h2>
        </div>
        <button className="admin-secondary-button" type="button" onClick={leave}>
          Back to inventory
        </button>
      </div>

      {stale ? (
        <p className="admin-inventory-note" role="alert">
          Stock changed since the physical count began. This snapshot is stale: reconcile the
          movement, cancel this count, then start a new count. Posting is blocked.
        </p>
      ) : null}
      {invalidCount ? (
        <p className="admin-inventory-note" role="alert">
          A count must be nonnegative with no more than six decimal places in the base unit.
        </p>
      ) : null}
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
                    setActualByItem((current) => ({ ...current, [line.inventoryItemId]: value }));
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
      <div className="admin-inventory-page-actions">
        {onCancelDraft ? (
          <button
            className="admin-secondary-button"
            type="button"
            disabled={pending || saving}
            onClick={() => {
              if (
                !window.confirm(
                  'Cancel this persisted count? This will not change inventory stock.',
                )
              )
                return;
              onCancelDraft();
            }}
          >
            Cancel count
          </button>
        ) : null}
        {onSaveDraft ? (
          <button
            className="admin-secondary-button"
            type="button"
            disabled={!changed || invalidCount || pending || saving || stale}
            onClick={() => {
              if (!changed || invalidCount) return;
              const submitted = { ...actualByItem };
              onSaveDraft(draftLines(), () => setSavedByItem(submitted));
            }}
          >
            {saving ? 'Saving…' : 'Save draft'}
          </button>
        ) : null}
        <button
          className="admin-primary-button"
          type="button"
          disabled={!valid || pending || saving || stale || changed}
          onClick={() => {
            if (!valid || changed || stale) return;
            onSubmit(
              parsed.map(({ line, actualMicros }) => ({
                inventoryItemId: line.inventoryItemId,
                actualCountMicros: actualMicros!,
              })),
            );
          }}
        >
          Post stock count
        </button>
      </div>
      {changed ? (
        <p className="admin-inventory-muted" role="status">
          Save draft before posting or leaving this count.
        </p>
      ) : null}
    </section>
  );
}
