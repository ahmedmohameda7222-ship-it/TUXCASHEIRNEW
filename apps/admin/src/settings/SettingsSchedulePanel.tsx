import { useState, type FormEvent } from 'react';

export type SettingsScheduleMode = 'PUBLISH_SETTINGS' | 'PAUSE_ONLINE' | 'RESUME_ONLINE';

export type SettingsScheduleDraft = {
  mode: SettingsScheduleMode;
  localScheduledAt: string;
};

export type SettingsScheduleSuccess = {
  scheduleId: string;
  status: string;
  scheduledFor: string;
  localScheduledAt: string;
  timezone: 'Africa/Cairo';
  idempotentReplay?: boolean;
};

export function SettingsSchedulePanel({
  onSchedule,
  busy = false,
}: {
  onSchedule: (draft: SettingsScheduleDraft) => Promise<SettingsScheduleSuccess>;
  busy?: boolean;
}) {
  const [mode, setMode] = useState<SettingsScheduleMode>('PUBLISH_SETTINGS');
  const [localScheduledAt, setLocalScheduledAt] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || localScheduledAt === '') return;

    setMessage(null);
    try {
      const result = await onSchedule({ mode, localScheduledAt });
      setMessage(
        `${result.idempotentReplay ? 'Existing schedule confirmed' : 'Scheduled'} for ${result.localScheduledAt} Africa/Cairo.`,
      );
    } catch {
      setMessage('Scheduling failed. Reload and try again.');
    }
  }

  return (
    <form className="admin-settings-card" onSubmit={(event) => void submit(event)}>
      <div>
        <span>Scheduled configuration</span>
        <strong>Activate later in Egypt local time</strong>
      </div>
      <p className="admin-field__help">
        Current staged settings are snapshotted when the schedule is accepted. Later unpublished
        edits are not pulled into that scheduled activation.
      </p>
      <div className="admin-settings-grid">
        <label className="admin-field">
          <span>Change</span>
          <select
            value={mode}
            disabled={busy}
            onChange={(event) => setMode(event.currentTarget.value as SettingsScheduleMode)}
          >
            <option value="PUBLISH_SETTINGS">Publish current staged settings</option>
            <option value="PAUSE_ONLINE">Pause online orders</option>
            <option value="RESUME_ONLINE">Resume online orders</option>
          </select>
        </label>
        <label className="admin-field">
          <span>Egypt local date/time</span>
          <input
            type="datetime-local"
            step={1}
            required
            value={localScheduledAt}
            disabled={busy}
            onChange={(event) => setLocalScheduledAt(event.currentTarget.value)}
          />
        </label>
      </div>
      <button
        className="admin-primary-button"
        type="submit"
        disabled={busy || localScheduledAt === ''}
      >
        {busy ? 'Scheduling…' : 'Schedule change'}
      </button>
      <small>
        Publishing staged settings covers configured opening/delivery/online hours and other settings
        owned by this workspace. Emergency controls above remain immediate.
      </small>
      {message ? (
        <p className="admin-field__help" aria-live="polite">
          {message}
        </p>
      ) : null}
    </form>
  );
}
