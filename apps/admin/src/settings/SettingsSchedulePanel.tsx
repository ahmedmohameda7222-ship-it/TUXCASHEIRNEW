import type { AdminSettingsWorkspace, AdminShopConfigSchedule } from '@tux/admin-contracts';
import { createContext, useContext, useState, type FormEvent, type ReactNode } from 'react';

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

type SettingsScheduleAction = {
  schedule(draft: SettingsScheduleDraft): Promise<SettingsScheduleSuccess>;
  busy: boolean;
};

const SettingsScheduleActionContext = createContext<SettingsScheduleAction | null>(null);

export function SettingsScheduleActionProvider({
  action,
  children,
}: {
  action: SettingsScheduleAction;
  children: ReactNode;
}) {
  return (
    <SettingsScheduleActionContext.Provider value={action}>
      {children}
    </SettingsScheduleActionContext.Provider>
  );
}

function scheduleLabel(schedule: AdminShopConfigSchedule): string {
  if (schedule.operation === 'PUBLISH_SETTINGS') return 'Publish staged settings';
  return schedule.onlineOrdersPaused ? 'Pause online orders' : 'Resume online orders';
}

function scheduleStatus(schedule: AdminShopConfigSchedule): string {
  switch (schedule.status) {
    case 'PENDING':
      return 'Scheduled';
    case 'CLAIMED':
      return 'Applying';
    case 'APPLIED':
      return 'Applied';
    case 'CANCELLED':
      return 'Cancelled';
    case 'FAILED':
      if (schedule.terminalFailure) return 'Failed · Reschedule required';
      return schedule.nextAttemptAt ? 'Failed · Retry queued' : 'Failed · Retry pending';
  }
}

export function SettingsSchedulePanel({
  workspace,
  busy = false,
}: {
  workspace: AdminSettingsWorkspace;
  busy?: boolean;
}) {
  const action = useContext(SettingsScheduleActionContext);
  const [mode, setMode] = useState<SettingsScheduleMode>('PUBLISH_SETTINGS');
  const [localScheduledAt, setLocalScheduledAt] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const disabled = busy || action === null || action.busy;
  const schedules = workspace.shopConfigSchedules ?? [];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || localScheduledAt === '' || action === null) return;

    setMessage(null);
    try {
      const result = await action.schedule({ mode, localScheduledAt });
      setMessage(
        `${result.idempotentReplay ? 'Existing schedule confirmed' : 'Scheduled'} for ${result.localScheduledAt} Africa/Cairo.`,
      );
    } catch {
      setMessage('Scheduling failed. Reload and try again.');
    }
  }

  return (
    <form
      className="admin-settings-card"
      data-settings-schedule-shop={workspace.shop.id}
      onSubmit={(event) => void submit(event)}
    >
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
            disabled={disabled}
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
            disabled={disabled}
            onChange={(event) => setLocalScheduledAt(event.currentTarget.value)}
          />
        </label>
      </div>
      <button
        className="admin-primary-button"
        type="submit"
        disabled={disabled || localScheduledAt === ''}
      >
        {action?.busy ? 'Scheduling…' : 'Schedule change'}
      </button>
      <small>
        Publishing staged settings covers configured opening/delivery/online hours and other
        settings owned by this workspace. Emergency controls above remain immediate.
      </small>
      {message ? (
        <p className="admin-field__help" aria-live="polite">
          {message}
        </p>
      ) : null}

      <div>
        <span>Durable schedule history</span>
        <strong>Latest 50 actions</strong>
      </div>
      {schedules.length === 0 ? (
        <p className="admin-field__help">No scheduled configuration history yet.</p>
      ) : (
        <div className="admin-settings-grid">
          {schedules.map((schedule) => (
            <article className="admin-settings-card" key={schedule.id}>
              <div>
                <span>{scheduleLabel(schedule)}</span>
                <strong>{scheduleStatus(schedule)}</strong>
              </div>
              <small>
                {schedule.localScheduledAt} {schedule.timezone} · attempt {schedule.attemptCount}
              </small>
              {schedule.status === 'FAILED' && !schedule.terminalFailure && schedule.nextAttemptAt ? (
                <small>Retry queued for {schedule.nextAttemptAt}</small>
              ) : null}
              {schedule.lastError ? <small>Last error: {schedule.lastError}</small> : null}
            </article>
          ))}
        </div>
      )}
    </form>
  );
}
