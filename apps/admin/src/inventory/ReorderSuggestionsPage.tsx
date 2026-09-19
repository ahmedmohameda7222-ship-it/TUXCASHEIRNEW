import type { AdminInventoryReorderSuggestion } from '@tux/admin-contracts';
import { useState } from 'react';

function quantity(micros: number, unitLabel: string): string {
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(
    micros / 1_000_000,
  )} ${unitLabel}`;
}

type ReplenishmentDraft = {
  parLevelMicros: string;
  reorderPointMicros: string;
  preferredPurchaseUnit: string;
  leadTimeDays: string;
  minimumOrderMicros: string;
  orderMultipleMicros: string;
};

type NumericReplenishmentDraftKey = Exclude<keyof ReplenishmentDraft, 'preferredPurchaseUnit'>;

const NUMERIC_REPLENISHMENT_FIELDS = [
  ['Par micros', 'parLevelMicros'],
  ['Reorder point micros', 'reorderPointMicros'],
  ['Lead time days', 'leadTimeDays'],
  ['Minimum order micros', 'minimumOrderMicros'],
  ['Order multiple micros', 'orderMultipleMicros'],
] as const satisfies readonly (readonly [string, NumericReplenishmentDraftKey])[];

export function ReorderSuggestionsPage({
  suggestions,
  canManage,
  saving,
  onBack,
  onSave,
}: {
  suggestions: readonly AdminInventoryReorderSuggestion[];
  canManage: boolean;
  saving: boolean;
  onBack: () => void;
  onSave: (
    inventoryItemId: string,
    input: {
      parLevelMicros: number;
      reorderPointMicros: number;
      preferredPurchaseUnit: string | null;
      leadTimeDays: number;
      minimumOrderMicros: number | null;
      orderMultipleMicros: number | null;
    },
  ) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, ReplenishmentDraft>>({});

  function draftFor(row: AdminInventoryReorderSuggestion): ReplenishmentDraft {
    return (
      drafts[row.inventoryItemId] ?? {
        parLevelMicros: String(row.parLevelMicros),
        reorderPointMicros: String(row.reorderPointMicros),
        preferredPurchaseUnit: row.preferredPurchaseUnit ?? '',
        leadTimeDays: String(row.leadTimeDays),
        minimumOrderMicros: row.minimumOrderMicros === null ? '' : String(row.minimumOrderMicros),
        orderMultipleMicros: row.orderMultipleMicros === null ? '' : String(row.orderMultipleMicros),
      }
    );
  }

  return (
    <section className="admin-inventory-intelligence">
      <div className="admin-inventory-section-heading">
        <button className="admin-secondary-button" type="button" onClick={onBack}>
          Back
        </button>
        <div>
          <h2>Reorder suggestions</h2>
          <p>
            Recommendation only. This screen does not create a purchase order or contact a
            supplier.
          </p>
        </div>
      </div>

      {suggestions.length === 0 ? (
        <div className="admin-empty-state">
          <strong>No replenishment policies yet</strong>
          <span>Configure a par level to produce a reorder recommendation.</span>
        </div>
      ) : (
        <div className="admin-inventory-intelligence-list">
          {suggestions.map((row) => {
            const draft = draftFor(row);
            return (
              <article className="admin-inventory-intelligence-card" key={row.inventoryItemId}>
                <header>
                  <div>
                    <strong>{row.itemName}</strong>
                    <span>
                      {row.preferredPurchaseUnit ?? row.unitLabel} · {row.leadTimeDays} days lead
                      time
                    </span>
                  </div>
                  <b>{quantity(row.suggestedOrderMicros, row.unitLabel)} suggested</b>
                </header>
                <dl className="admin-inventory-metrics">
                  <div>
                    <dt>Available</dt>
                    <dd>{quantity(row.availableMicros, row.unitLabel)}</dd>
                  </div>
                  <div>
                    <dt>Incoming</dt>
                    <dd>{quantity(row.incomingMicros, row.unitLabel)}</dd>
                  </div>
                  <div>
                    <dt>Par</dt>
                    <dd>{quantity(row.parLevelMicros, row.unitLabel)}</dd>
                  </div>
                  <div>
                    <dt>Suggested</dt>
                    <dd>{quantity(row.suggestedOrderMicros, row.unitLabel)}</dd>
                  </div>
                </dl>
                {row.preferredSupplierId ? (
                  <p className="admin-inventory-note">
                    Preferred supplier: {row.preferredSupplierId}. Supplier details are resolved
                    by Purchasing.
                  </p>
                ) : null}
                {canManage ? (
                  <form
                    className="admin-inventory-policy-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      onSave(row.inventoryItemId, {
                        parLevelMicros: Number(draft.parLevelMicros),
                        reorderPointMicros: Number(draft.reorderPointMicros),
                        preferredPurchaseUnit: draft.preferredPurchaseUnit.trim() || null,
                        leadTimeDays: Number(draft.leadTimeDays),
                        minimumOrderMicros:
                          draft.minimumOrderMicros === '' ? null : Number(draft.minimumOrderMicros),
                        orderMultipleMicros:
                          draft.orderMultipleMicros === '' ? null : Number(draft.orderMultipleMicros),
                      });
                    }}
                  >
                    {NUMERIC_REPLENISHMENT_FIELDS.map(([label, key]) => (
                      <label key={key}>
                        <span>{label}</span>
                        <input
                          inputMode="numeric"
                          value={draft[key as keyof ReplenishmentDraft]}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [row.inventoryItemId]: {
                                ...draft,
                                [key]: event.currentTarget.value,
                              },
                            }))
                          }
                        />
                      </label>
                    ))}
                    <label>
                      <span>Preferred purchase unit</span>
                      <input
                        value={draft.preferredPurchaseUnit}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [row.inventoryItemId]: {
                              ...draft,
                              preferredPurchaseUnit: event.currentTarget.value,
                            },
                          }))
                        }
                      />
                    </label>
                    <button className="admin-primary-button" disabled={saving} type="submit">
                      {saving ? 'Saving…' : 'Save policy'}
                    </button>
                  </form>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
