import type { AdminReasonCodeConfiguration } from '@tux/admin-contracts';
import { useEffect, useState, type FormEvent } from 'react';

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
    await onSubmit({
      reasonCodeId,
      note: note.trim() || null,
      pin,
    });
    setPin('');
  }

  return (
    <form className="admin-catalog-editor__section" onSubmit={(event) => void submit(event)}>
      <div className="admin-catalog-editor__section-heading">
        <div>
          <p className="admin-page__eyebrow">Sensitive order action</p>
          <h2>Cancel order</h2>
        </div>
      </div>
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
          Back
        </button>
        <button
          className="admin-primary-button"
          type="submit"
          disabled={pending || !reasonCodeId || !pin}
        >
          {pending ? 'Cancelling…' : 'Confirm cancellation'}
        </button>
      </div>
    </form>
  );
}
