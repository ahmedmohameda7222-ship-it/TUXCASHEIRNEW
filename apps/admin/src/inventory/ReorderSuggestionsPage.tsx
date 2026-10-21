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
  ['Par level', 'parLevelMicros', 'quantity'],
  ['Reorder point', 'reorderPointMicros', 'quantity'],
  ['Lead time (days)', 'leadTimeDays', 'days'],
  ['Minimum order', 'minimumOrderMicros', 'quantity'],
  ['Order multiple', 'orderMultipleMicros', 'quantity'],
] as const satisfies readonly (readonly [
  string,
  NumericReplenishmentDraftKey,
  'quantity' | 'days',
])[];

function quantityInput(micros: number | null): string {
  return micros === null ? '' : String(micros / 1_000_000);
}

function quantityMicros(value: string): number | null {
  if (value.trim() === '') return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const micros = Math.round(amount * 1_000_000);
  return Number.isSafeInteger(micros) ? micros : null;
}

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
      expectedVersion: number;
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
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  function draftFor(row: AdminInventoryReorderSuggestion): ReplenishmentDraft {
    return (
      drafts[row.inventoryItemId] ?? {
        parLevelMicros: quantityInput(row.parLevelMicros),
        reorderPointMicros: quantityInput(row.reorderPointMicros),
        preferredPurchaseUnit: row.preferredPurchaseUnit ?? '',
        leadTimeDays: String(row.leadTimeDays),
        minimumOrderMicros: quantityInput(row.minimumOrderMicros),
        orderMultipleMicros: quantityInput(row.orderMultipleMicros),
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
            Recommendation only. This screen does not create a purchase order or contact a supplier.
          </p>
        </div>
      </div>

      {suggestions.length === 0 ? (
        <div className="admin-inventory-empty-state">
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
                    <dt>Reorder trigger</dt>
                    <dd>{quantity(row.reorderPointMicros, row.unitLabel)}</dd>
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
                {row.preferredSupplierName ? (
                  <p className="admin-inventory-note">
                    Preferred supplier: {row.preferredSupplierName}
                  </p>
                ) : null}
                {canManage ? (
                  <button
                    className="admin-secondary-button"
                    type="button"
                    aria-expanded={editingItemId === row.inventoryItemId}
                    aria-controls={'inventory-policy-' + row.inventoryItemId}
                    onClick={() => {
                      setValidationError(null);
                      setEditingItemId((current) =>
                        current === row.inventoryItemId ? null : row.inventoryItemId,
                      );
                    }}
                  >
                    {editingItemId === row.inventoryItemId
                      ? 'Close policy editor'
                      : 'Edit policy for ' + row.itemName}
                  </button>
                ) : null}
                {canManage && editingItemId === row.inventoryItemId ? (
                  <form
                    id={'inventory-policy-' + row.inventoryItemId}
                    aria-label={'Replenishment policy for ' + row.itemName}
                    className="admin-inventory-policy-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const par = quantityMicros(draft.parLevelMicros);
                      const reorder = quantityMicros(draft.reorderPointMicros);
                      const leadDays = Number(draft.leadTimeDays);
                      const optionalQuantities = [
                        draft.minimumOrderMicros,
                        draft.orderMultipleMicros,
                      ];
                      if (
                        par === null ||
                        reorder === null ||
                        !Number.isSafeInteger(leadDays) ||
                        leadDays < 0 ||
                        optionalQuantities.some(
                          (value) => value.trim() !== '' && quantityMicros(value) === null,
                        )
                      ) {
                        setValidationError(
                          'Use valid non-negative quantities and whole lead-time days.',
                        );
                        return;
                      }
                      setValidationError(null);
                      onSave(row.inventoryItemId, {
                        expectedVersion: row.version,
                        parLevelMicros: par,
                        reorderPointMicros: reorder,
                        preferredPurchaseUnit: draft.preferredPurchaseUnit.trim() || null,
                        leadTimeDays: leadDays,
                        minimumOrderMicros: quantityMicros(draft.minimumOrderMicros),
                        orderMultipleMicros: quantityMicros(draft.orderMultipleMicros),
                      });
                    }}
                  >
                    {NUMERIC_REPLENISHMENT_FIELDS.map(([label, key, kind]) => (
                      <label key={key}>
                        <span>{kind === 'quantity' ? `${label} (${row.unitLabel})` : label}</span>
                        <input
                          inputMode={kind === 'quantity' ? 'decimal' : 'numeric'}
                          type="number"
                          step={kind === 'quantity' ? 'any' : '1'}
                          min="0"
                          required={
                            key === 'parLevelMicros' ||
                            key === 'reorderPointMicros' ||
                            key === 'leadTimeDays'
                          }
                          value={draft[key as keyof ReplenishmentDraft]}
                          onChange={(event) => {
                            const value = event.currentTarget.value;
                            setDrafts((current) => ({
                              ...current,
                              [row.inventoryItemId]: { ...draft, [key]: value },
                            }));
                          }}
                        />
                      </label>
                    ))}
                    <label>
                      <span>Preferred purchase unit</span>
                      <input
                        value={draft.preferredPurchaseUnit}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          setDrafts((current) => ({
                            ...current,
                            [row.inventoryItemId]: { ...draft, preferredPurchaseUnit: value },
                          }));
                        }}
                      />
                    </label>
                    {validationError ? <p role="alert">{validationError}</p> : null}
                    <div className="admin-inventory-policy-actions">
                      <button
                        className="admin-secondary-button"
                        type="button"
                        disabled={saving}
                        onClick={() => {
                          setValidationError(null);
                          setEditingItemId(null);
                        }}
                      >
                        Cancel
                      </button>
                      <button className="admin-primary-button" disabled={saving} type="submit">
                        {saving ? 'Saving…' : 'Save policy'}
                      </button>
                    </div>
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
