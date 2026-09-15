import { useState, type FormEvent } from 'react';

import type { CatalogPublishPreview } from '@tux/admin-contracts';

type ScheduleEditorProps = {
  preview: CatalogPublishPreview;
  disabled: boolean;
  isPending: boolean;
  onSchedule(localScheduledAt: string): Promise<void>;
};

export function ScheduleEditor({ preview, disabled, isPending, onSchedule }: ScheduleEditorProps) {
  const [localScheduledAt, setLocalScheduledAt] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!localScheduledAt || disabled || preview.stale || isPending) return;
    await onSchedule(localScheduledAt);
  }

  return (
    <section className="admin-publish-card" aria-labelledby="catalog-schedule-heading">
      <div className="admin-publish-card__heading">
        <div>
          <p className="admin-catalog-editor__eyebrow">Scheduled activation</p>
          <h2 id="catalog-schedule-heading">Schedule publish</h2>
        </div>
        <span className="admin-status-pill">Africa/Cairo</span>
      </div>

      <p className="admin-publish-card__copy">
        Store the intended Cairo wall-clock time. The trusted scheduler resolves and executes the
        canonical activation with the draft revision and live-version fence shown above.
      </p>

      <form className="admin-publish-schedule-form" onSubmit={(event) => void submit(event)}>
        <label className="admin-field">
          <span>Activation time (Cairo)</span>
          <input
            type="datetime-local"
            value={localScheduledAt}
            onChange={(event) => setLocalScheduledAt(event.target.value)}
            disabled={disabled || preview.stale || isPending}
          />
        </label>
        <button
          className="admin-primary-button"
          type="submit"
          disabled={!localScheduledAt || disabled || preview.stale || isPending}
        >
          {isPending ? 'Scheduling…' : 'Schedule publish'}
        </button>
      </form>
    </section>
  );
}
