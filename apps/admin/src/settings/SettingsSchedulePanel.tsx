import type { AdminSettingsWorkspace } from '@tux/admin-contracts';
import { useState, type FormEvent } from 'react';

import { useAdminSession } from '../auth/useAdminSession';
import { adminFetch } from '../lib/adminApi';

type ScheduleMode = 'PUBLISH_SETTINGS' | 'PAUSE_ONLINE' | 'RESUME_ONLINE';

type ScheduleResult =
  | {
      ok: true;
      scheduleId: string;
      status: string;
      scheduledFor: string;
      localScheduledAt: string;
      timezone: 'Africa/Cairo';
      idempotentReplay?: boolean;
    }
  | { ok: false; code: string; currentVersion?: number };

export function SettingsSchedulePanel({
  workspace,
  busy = false,
}: {
  workspace: AdminSettingsWorkspace;
  busy?: boolean;
}) {
  const session = useAdminSession();
  const [mode, setMode] = useState<ScheduleMode>('PUBLISH_SETTINGS');
  const [localScheduledAt, setLocalScheduledAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || submitting || localScheduledAt === '') return;
    if (session.state.status !== 'authenticated') {
      setMessage('Admin session required.');
      return;
    }

    setSubmitting(true);
    setMessage(null);
    try {
      const common = {
        shopId: workspace.shop.id,
        expectedSettingsVersion: workspace.settingsVersion,
        localScheduledAt,
      };
      const command =
        mode === 'PUBLISH_SETTINGS'
          ? { type: 'settings.schedule-publish' as const, ...common }
          : {
              type: 'shop.online-orders.schedule' as const,
              ...common,
              onlineOrdersPaused: mode === 'PAUSE_ONLINE',
            };
      const result = await adminFetch<ScheduleResult>(
        '/api/admin/settings-schedule',
        { method: 'POST', body: JSON.stringify(command) },
        session.state.session.csrfToken,
      );
      if (!result.ok) {
        setMessage(
          result.code === 'stale_settings_version'
            ? `Settings changed (current version ${result.currentVersion ?? 'unknown'}). Reload before scheduling.`
            : `Schedule rejected: ${result.code}`,
        );
        return;
      }
      setMessage(
        `${result.idempotentReplay ? 'Existing schedule confirmed' : 'Scheduled'} for ${result.localScheduledAt} Africa/Cairo.`,
      );
    } catch {
      setMessage('Scheduling failed. Reload and try again.');
    } finally {
      setSubmitting(false);
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
            disabled={busy || submitting}
            onChange={(event) => setMode(event.currentTarget.value as ScheduleMode)}
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
            disabled={busy || submitting}
            onChange={(event) => setLocalScheduledAt(event.currentTarget.value)}
          />
        </label>
      </div>
      <button
        className="admin-primary-button"
        type="submit"
        disabled={busy || submitting || localScheduledAt === ''}
      >
        {submitting ? 'Scheduling…' : 'Schedule change'}
      </button>
      <small>
        Publishing staged settings covers configured opening/delivery/online hours and other settings
        owned by this workspace. Emergency controls above remain immediate.
      </small>
      {message ? <p className="admin-field__help" aria-live="polite">{message}</p> : null}
    </form>
  );
}
