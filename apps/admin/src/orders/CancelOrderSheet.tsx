import type { AdminReasonCodeConfiguration } from '@tux/admin-contracts';
import { useEffect, useState, type FormEvent } from 'react';

import { AdminDialog } from '../components/overlay/AdminDialog';

export type CancelOrderDraft = {
  reasonCodeId: string;
  note: string | null;
  pin: string;
};

export function CancelOrderSheet({
  reasons,
  pending,
  onCancel,
  onSubmit,
}: {
  reasons: readonly AdminReasonCodeConfiguration[];
  pending: boolean;
  onCancel(): void;
  onSubmit(input: CancelOrderDraft): void | Promise<void>;
}) {
  const [reasonCodeId, setReasonCodeId] = useState(reasons[0]?.id ?? '');
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');

  useEffect(() => {
    if (reasons.some((reason) => reason.id === reasonCodeId)) return;
    setReasonCodeId(reasons[0]?.id ?? '');
  }, [reasonCodeId, reasons]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reasonCodeId || !pin) return;
    await onSubmit({ reasonCodeId, note: note.trim() || null, pin });
    setPin('');
  }

  return (
    <AdminDialog
      open
      variant="sheet"
      title="Cancel order"
      description="Choose the business reason and confirm this sensitive action with your Admin PIN."
      destructive
      onOpenChange={(open) => {
        if (!open && !pending) onCancel();
      }}
    >
      <form
        className="admin-catalog-editor__section is-compact"
        onSubmit={(event) => void submit(event)}
      >
        <label className="admin-field">
          <span>Cancellation reason</span>
          <select
            value={reasonCodeId}
            disabled={pending || reasons.length === 0}
            onChange={(event) => setReasonCodeId(event.target.value)}
          >
            {reasons.map((reason) => (
              <option key={reason.id} value={reason.id}>
                {reason.label}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-field">
          <span>Note</span>
          <textarea
            value={note}
            maxLength={500}
            disabled={pending}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <label className="admin-field">
          <span>Admin PIN</span>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            value={pin}
            disabled={pending}
            onChange={(event) => setPin(event.target.value)}
          />
        </label>
        <div className="admin-page__primary-action">
          <button
            className="admin-secondary-button"
            type="button"
            disabled={pending}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="admin-destructive-button"
            type="submit"
            disabled={pending || !reasonCodeId || !pin}
          >
            {pending ? 'Cancelling…' : 'Confirm cancellation'}
          </button>
        </div>
      </form>
    </AdminDialog>
  );
}
