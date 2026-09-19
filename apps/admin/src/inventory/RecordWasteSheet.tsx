import type { AdminInventoryItem, AdminInventoryReasonCode } from '@tux/admin-contracts';
import { useMemo, useState } from 'react';

function toPositiveMicros(value: string): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const micros = Math.round(numeric * 1_000_000);
  return Number.isSafeInteger(micros) && micros > 0 ? micros : null;
}

export function RecordWasteSheet({
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
    quantityMicros: number;
    reasonCodeId: string;
    note: string | null;
    emergencyNegativeOverride: boolean;
  }): void;
}) {
  const options = useMemo(() => reasons.filter((reason) => reason.family === 'WASTE'), [reasons]);
  const [quantity, setQuantity] = useState('');
  const [reasonCodeId, setReasonCodeId] = useState(options[0]?.id ?? '');
  const [note, setNote] = useState('');
  const [override, setOverride] = useState(false);
  const micros = toPositiveMicros(quantity);

  return (
    <section className="admin-inventory-sheet" aria-label="Record waste">
      <div className="admin-inventory-sheet__heading">
        <div>
          <p className="admin-page__eyebrow">Immutable waste movement</p>
          <h3>Record waste</h3>
        </div>
        <button className="admin-secondary-button" type="button" onClick={onCancel}>
          Close
        </button>
      </div>
      <label className="admin-field">
        <span>Waste quantity</span>
        <input
          aria-label="Waste quantity"
          inputMode="decimal"
          placeholder={`0.25 ${item.unitLabel}`}
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
      </label>
      <label className="admin-select-field">
        <span>Waste reason</span>
        <select
          aria-label="Waste reason"
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
        disabled={
          pending || micros === null || reasonCodeId.length === 0 || (override && !note.trim())
        }
        onClick={() => {
          if (micros === null) return;
          onSubmit({
            quantityMicros: micros,
            reasonCodeId,
            note: note.trim() || null,
            emergencyNegativeOverride: override,
          });
        }}
      >
        Post waste
      </button>
    </section>
  );
}
