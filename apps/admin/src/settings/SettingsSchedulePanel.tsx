import type { AdminSettingsWorkspace, AdminShopConfigSchedule } from '@tux/admin-contracts';
import { createContext, useContext, type ReactNode } from 'react';

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
  historyLoading?: boolean;
  historyError?: boolean;
  retryHistory?: () => void;
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
  if (schedule.operation === 'PUBLISH_SETTINGS') return 'Publish saved settings';
  return schedule.onlineOrdersPaused ? 'Pause online orders' : 'Resume online orders';
}

function scheduleStatus(schedule: AdminShopConfigSchedule): string {
  switch (schedule.status) {
    case 'PENDING':
      return 'Pending — no automatic runner';
    case 'CLAIMED':
      return 'Claimed (not verified)';
    case 'APPLIED':
      return 'Applied';
    case 'CANCELLED':
      return 'Cancelled';
    case 'FAILED':
      return 'Needs attention';
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
  const schedules = workspace.shopConfigSchedules ?? [];

  return (
    <section
      className="admin-settings-card"
      data-settings-schedule-shop={workspace.shop.id}
      aria-busy={busy}
    >
      <div>
        <span>Scheduled configuration</span>
        <strong>Automatic scheduling is unavailable</strong>
      </div>
      <p className="admin-field__help">
        No verified unattended scheduler is configured. New scheduled settings changes, pauses, and
        resumes are disabled. Existing schedule history is preserved and must not be mistaken for an
        active automatic transition. Publish settings or change online order availability manually.
      </p>

      <div>
        <span>Durable schedule history</span>
        <strong>Latest 50 actions</strong>
      </div>
      {action?.historyLoading ? (
        <p className="admin-field__help">Loading scheduled configuration history…</p>
      ) : action?.historyError ? (
        <div>
          <p role="alert">Scheduled history unavailable. Other shop settings remain available.</p>
          <button className="admin-secondary-button" type="button" onClick={action.retryHistory}>
            Retry history
          </button>
        </div>
      ) : schedules.length === 0 ? (
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
                {schedule.localScheduledAt} {schedule.timezone}
              </small>
              {schedule.status === 'FAILED' ? (
                <small>Review the failure and publish the saved settings manually.</small>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
