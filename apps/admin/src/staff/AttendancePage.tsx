import type { EmployeeDetail } from '@tux/admin-contracts';
import { useMemo, useState } from 'react';

import { businessLocalDateTimeToIso, formatBusinessDateTime } from './businessTime';
import type { StaffCommandDraft } from './SchedulePage';

export function AttendancePage({
  employee,
  shopId,
  canManage,
  onCommand,
}: {
  employee: EmployeeDetail;
  shopId: string;
  canManage: boolean;
  onCommand(command: StaffCommandDraft): void;
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

  return (
    <section aria-label="Attendance">
      <h3>Attendance</h3>
      <p>Original Operations clock facts remain immutable; corrections are separate audited facts.</p>
      {events.length === 0 ? <p>No projected attendance events yet.</p> : null}
      {events.map((event) => {
        const correction = latestCorrection.get(event.id);
        return (
          <article className="admin-inventory-row" key={event.id}>
            <span>
              <strong>{event.eventType.replaceAll('_', ' ')}</strong>
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
        <section className="admin-catalog-editor__section is-compact">
          <h4>Correct attendance</h4>
          <label className="admin-field">
            <span>Attendance event</span>
            <select value={eventId} onChange={(event) => setEventId(event.target.value)}>
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.eventType} · {formatBusinessDateTime(event.occurredAt)}
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
          <button
            className="admin-primary-button"
            type="button"
            disabled={!eventId || !correctedAt || !reason.trim()}
            onClick={() =>
              onCommand({
                type: 'attendance.correct',
                attendanceEventId: eventId,
                shopId,
                correctedOccurredAt: businessLocalDateTimeToIso(correctedAt),
                reason: reason.trim(),
              })
            }
          >
            Record correction
          </button>
        </section>
      ) : null}
    </section>
  );
}
