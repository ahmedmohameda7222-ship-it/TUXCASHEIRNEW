import type { AdminInventoryItem, AdminInventoryReasonCode } from '@tux/admin-contracts';
import { useMemo, useState } from 'react';

import { AdminDialog } from '../components/overlay/AdminDialog';
import { parseInventoryMicros } from './inventoryQuantityInput';

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
    requesterPin?: string;
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
  const [requesterPin, setRequesterPin] = useState('');
  const micros = parseInventoryMicros(quantity, true);

  return (
    <AdminDialog
      open
      variant="sheet"
      title={`Adjust ${item.name}`}
      description="Record the quantity change and why it is needed."
      onOpenChange={(open) => {
        if (!open && !pending) onCancel();
      }}
    >
      <label className="admin-field">
        <span>Quantity change ({item.unitLabel})</span>
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
          <span>Allow stock to go below zero</span>
        </label>
      ) : null}
      <label className="admin-field">
        <span>Approval PIN (only if required by your shop's policy)</span>
        <input
          type="password"
          autoComplete="off"
          aria-label="Approval PIN"
          value={requesterPin}
          onChange={(event) => setRequesterPin(event.target.value)}
        />
        <small>The PIN is submitted only to verify your approval request.</small>
      </label>
      <button
        className="admin-primary-button"
        type="button"
        disabled={
          pending || micros === null || reasonCodeId.length === 0 || (override && !note.trim())
        }
        onClick={() => {
          if (micros === null) return;
          onSubmit({
            quantityDeltaMicros: micros,
            reasonCodeId,
            note: note.trim() || null,
            emergencyNegativeOverride: override,
            ...(requesterPin ? { requesterPin } : {}),
          });
        }}
      >
        Post adjustment
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
