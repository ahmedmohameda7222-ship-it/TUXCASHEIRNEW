import type { AdminInventoryItem, AdminInventoryReasonCode } from '@tux/admin-contracts';
import { useMemo, useState } from 'react';

function toMicros(value: string): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) return null;
  const micros = Math.round(numeric * 1_000_000);
  return Number.isSafeInteger(micros) && micros !== 0 ? micros : null;
}

export function AdjustStockSheet({
  item,
  reasons,
  canOverrideNegative,
  pending,
  onCancel,
  onSubmit,
}: {
  item: AdminInventoryItem;
  reasons: readonly AdminInventoryReasonCode[];
  canOverrideNegative: boolean;
  pending: boolean;
  onCancel(): void;
  onSubmit(input: {
    quantityDeltaMicros: number;
    reasonCodeId: string;
    note: string | null;
    emergencyNegativeOverride: boolean;
  }): void;
}) {
  const options = useMemo(
    () => reasons.filter((reason) => reason.family === 'STOCK_ADJUSTMENT'),
    [reasons],
  );
  const [quantity, setQuantity] = useState('');
  const [reasonCodeId, setReasonCodeId] = useState(options[0]?.id ?? '');
  const [note, setNote] = useState('');
  const [override, setOverride] = useState(false);
  const micros = toMicros(quantity);

  return (
    <section className="admin-inventory-sheet" aria-label="Adjust stock">
      <div className="admin-inventory-sheet__heading">
        <div>
          <p className="admin-page__eyebrow">Ledger command</p>
          <h3>Adjust stock</h3>
        </div>
        <button className="admin-secondary-button" type="button" onClick={onCancel}>
          Close
        </button>
      </div>
      <label className="admin-field">
        <span>Quantity change</span>
        <input
          aria-label="Quantity change"
          inputMode="decimal"
          placeholder={`0.5 ${item.unitLabel}`}
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
      </label>
      <label className="admin-select-field">
        <span>Adjustment reason</span>
        <select
          aria-label="Adjustment reason"
          value={reasonCodeId}
          onChange={(event) => setReasonCodeId(event.target.value)}
        >
          {options.map((reason) => (
            <option key={reason.id} value={reason.id}>
              {reason.label}
            </option>
          ))}
        </select>
      </label>
      <label className="admin-field">
        <span>Note</span>
        <textarea value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      {canOverrideNegative ? (
        <label className="admin-check-field">
          <input
            type="checkbox"
            checked={override}
            onChange={(event) => setOverride(event.target.checked)}
          />
          <span>Emergency negative-stock override (OWNER only)</span>
        </label>
      ) : null}
      <button
        className="admin-primary-button"
        type="button"
        disabled={pending || micros === null || reasonCodeId.length === 0 || (override && !note.trim())}
        onClick={() => {
          if (micros === null) return;
          onSubmit({
            quantityDeltaMicros: micros,
            reasonCodeId,
            note: note.trim() || null,
            emergencyNegativeOverride: override,
          });
        }}
      >
        Post adjustment
      </button>
    </section>
  );
}
