import type { EmployeeDetail } from '@tux/admin-contracts';
import { useMemo, useState } from 'react';

import { AdminDialog } from '../components/overlay/AdminDialog';
import { businessLocalDateTimeToIso, formatBusinessDateTime } from './businessTime';
import type { StaffCommandDraft } from './SchedulePage';

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours > 0 ? `${hours}h ${remainder}m` : `${remainder}m`;
}

function eventLabel(value: string): string {
  return value === 'SESSION_START' ? 'Clock in' : 'Clock out';
}

export function AttendancePage({
  employee,
  shopId,
  canManage,
  onCommand,
  onVerifiedCommand,
}: {
  employee: EmployeeDetail;
  shopId: string;
  canManage: boolean;
  onCommand(command: StaffCommandDraft): void;
  onVerifiedCommand?: ((command: StaffCommandDraft) => Promise<unknown>) | undefined;
}) {
  const events = employee.attendanceEvents.filter((event) => event.shopId === shopId);
  const corrections = employee.attendanceCorrections.filter(
    (correction) => correction.shopId === shopId,
  );
  const latestCorrection = useMemo(() => {
    const map = new Map<string, (typeof corrections)[number]>();
    for (const correction of corrections) {
      if (!map.has(correction.attendanceEventId)) map.set(correction.attendanceEventId, correction);
    }
    return map;
  }, [corrections]);
  const [eventId, setEventId] = useState(events[0]?.id ?? '');
  const [correctedAt, setCorrectedAt] = useState('');
  const [reason, setReason] = useState('');
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [savingCorrection, setSavingCorrection] = useState(false);
  const [correctionError, setCorrectionError] = useState<string | null>(null);

  return (
    <section aria-label="Attendance">
      <h3>Attendance</h3>
      <p>
        Original clock events are preserved. Corrections are recorded separately for audit history.
      </p>
      {employee.attendanceSummaries.length === 0 ? (
        <p>No completed or historical attendance summaries yet.</p>
      ) : null}
      {employee.attendanceSummaries
        .filter((summary) => summary.shopId === shopId)
        .map((summary) => (
          <article
            className="admin-staff-section is-compact"
            key={summary.scheduledShiftId ?? `session-${summary.actualStartsAt ?? 'unknown'}`}
          >
            <strong>
              {summary.absent
                ? 'Absent'
                : summary.actualStartsAt
                  ? formatBusinessDateTime(summary.actualStartsAt)
                  : 'Attendance'}
            </strong>
            <dl>
              <dt>Scheduled</dt>
              <dd>
                {summary.scheduledStartsAt && summary.scheduledEndsAt
                  ? `${formatBusinessDateTime(summary.scheduledStartsAt)} → ${formatBusinessDateTime(
                      summary.scheduledEndsAt,
                    )}`
                  : 'No matched shift'}
              </dd>
              <dt>Actual</dt>
              <dd>
                {summary.actualStartsAt
                  ? `${formatBusinessDateTime(summary.actualStartsAt)} → ${summary.actualEndsAt ? formatBusinessDateTime(summary.actualEndsAt) : 'Open'}`
                  : 'No clock facts'}
              </dd>
              <dt>Break</dt>
              <dd>{formatDuration(summary.plannedBreakMinutes)}</dd>
              <dt>Worked</dt>
              <dd>{formatDuration(summary.workedMinutes)}</dd>
              <dt>Late</dt>
              <dd>{formatDuration(summary.lateMinutes)}</dd>
              <dt>Left early</dt>
              <dd>{formatDuration(summary.leftEarlyMinutes)}</dd>
              <dt>Overtime</dt>
              <dd>{formatDuration(summary.overtimeMinutes)}</dd>
            </dl>
          </article>
        ))}
      {events.length === 0 ? <p>No projected attendance events yet.</p> : null}
      {events.map((event) => {
        const correction = latestCorrection.get(event.id);
        return (
          <article className="admin-staff-record-row" key={event.id}>
            <span>
              <strong>{eventLabel(event.eventType)}</strong>
              <small>{formatBusinessDateTime(event.occurredAt)}</small>
            </span>
            <span>
              {correction
                ? `Corrected to ${formatBusinessDateTime(correction.correctedOccurredAt)}`
                : 'Original'}
            </span>
          </article>
        );
      })}

      {canManage && events.length > 0 ? (
        <>
          <button
            className="admin-secondary-button"
            type="button"
            onClick={() => setCorrectionOpen(true)}
          >
            Correct attendance
          </button>
          <AdminDialog
            open={correctionOpen}
            variant="sheet"
            title="Correct attendance"
            description="Record the corrected time and why it changed. The original event remains in history."
            onOpenChange={(open) => {
              if (!savingCorrection) setCorrectionOpen(open);
            }}
          >
            <label className="admin-field">
              <span>Attendance event</span>
              <select value={eventId} onChange={(event) => setEventId(event.target.value)}>
                {events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {eventLabel(event.eventType)} · {formatBusinessDateTime(event.occurredAt)}
                  </option>
                ))}
              </select>
            </label>
            <label className="admin-field">
              <span>Corrected time</span>
              <input
                type="datetime-local"
                value={correctedAt}
                onChange={(event) => setCorrectedAt(event.target.value)}
              />
            </label>
            <label className="admin-field">
              <span>Reason</span>
              <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
            </label>
            {correctionError ? <p role="alert">{correctionError}</p> : null}
            <button
              className="admin-primary-button"
              type="button"
              disabled={!eventId || !correctedAt || !reason.trim() || savingCorrection}
              onClick={async () => {
                setCorrectionError(null);
                setSavingCorrection(true);
                try {
                  const command: StaffCommandDraft = {
                    type: 'attendance.correct',
                    attendanceEventId: eventId,
                    shopId,
                    correctedOccurredAt: businessLocalDateTimeToIso(correctedAt),
                    reason: reason.trim(),
                  };
                  if (onVerifiedCommand) await onVerifiedCommand(command);
                  else onCommand(command);
                  setCorrectionOpen(false);
                } catch (error) {
                  setCorrectionError(
                    error instanceof Error ? error.message.replaceAll('_', ' ') : 'Attendance correction failed',
                  );
                } finally {
                  setSavingCorrection(false);
                }
              }}
            >
              Record correction
            </button>
          </AdminDialog>
        </>
      ) : null}
    </section>
  );
}
