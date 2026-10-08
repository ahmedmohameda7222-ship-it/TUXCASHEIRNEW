import type { AdminInventoryItem, AdminInventoryReasonCode } from '@tux/admin-contracts';
import { useMemo, useState } from 'react';

import { AdminDialog } from '../components/overlay/AdminDialog';

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
    <AdminDialog
      open
      variant="sheet"
      title={`Record waste for ${item.name}`}
      description="Enter the wasted quantity and choose the reason."
      onOpenChange={(open) => {
        if (!open && !pending) onCancel();
      }}
    >
      <label className="admin-field">
        <span>Waste quantity ({item.unitLabel})</span>
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
          <span>Allow stock to go below zero</span>
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
      <button
        className="admin-secondary-button"
        type="button"
        disabled={pending}
        onClick={onCancel}
      >
        Cancel
      </button>
    </AdminDialog>
  );
}
