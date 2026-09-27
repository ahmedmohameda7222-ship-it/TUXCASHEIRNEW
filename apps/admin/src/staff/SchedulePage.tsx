import type { EmployeeDetail } from '@tux/admin-contracts';
import { useState } from 'react';

import {
  businessDateTimeInputValue,
  businessLocalDateTimeToIso,
  formatBusinessDateTime,
} from './businessTime';

export type StaffCommandDraft = Readonly<Record<string, unknown>> & { readonly type: string };

export function SchedulePage({
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
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [breakMinutes, setBreakMinutes] = useState('0');
  const [targetWeekStart, setTargetWeekStart] = useState('');
  const [editingShiftId, setEditingShiftId] = useState<string | null>(null);

  const shifts = employee.shifts.filter((shift) => shift.shopId === shopId);

  return (
    <section aria-label="Schedule">
      <h3>Schedule</h3>
      {shifts.length === 0 ? <p>No scheduled shifts for this shop.</p> : null}
      {shifts.map((shift) => (
        <article className="admin-inventory-row" key={shift.id}>
          <span>
            <strong>{formatBusinessDateTime(shift.startsAt)}</strong>
            <small>
              {formatBusinessDateTime(shift.endsAt)} · {shift.plannedBreakMinutes} min break
            </small>
          </span>
          <span>
            {shift.status}
            {canManage && shift.status !== 'CANCELLED' ? (
              <>
                <button
                  className="admin-secondary-button"
                  type="button"
                  onClick={() => {
                    setEditingShiftId(shift.id);
                    setStartsAt(businessDateTimeInputValue(shift.startsAt));
                    setEndsAt(businessDateTimeInputValue(shift.endsAt));
                    setBreakMinutes(String(shift.plannedBreakMinutes));
                  }}
                >
                  Edit
                </button>
                <button
                  className="admin-secondary-button"
                  type="button"
                  onClick={() =>
                    onCommand({
                      type: 'shift.cancel',
                      shiftId: shift.id,
                      shopId,
                      expectedVersion: shift.version,
                    })
                  }
                >
                  Remove
                </button>
              </>
            ) : null}
          </span>
        </article>
      ))}

      {canManage ? (
        <>
          <section className="admin-catalog-editor__section is-compact">
            <h4>{editingShiftId ? 'Edit shift' : 'Add shift'}</h4>
            <label className="admin-field">
              <span>Starts</span>
              <input
                type="datetime-local"
                value={startsAt}
                onChange={(event) => setStartsAt(event.target.value)}
              />
            </label>
            <label className="admin-field">
              <span>Ends</span>
              <input
                type="datetime-local"
                value={endsAt}
                onChange={(event) => setEndsAt(event.target.value)}
              />
            </label>
            <label className="admin-field">
              <span>Break minutes</span>
              <input
                inputMode="numeric"
                value={breakMinutes}
                onChange={(event) => setBreakMinutes(event.target.value)}
              />
            </label>
            <button
              className="admin-primary-button"
              type="button"
              disabled={!startsAt || !endsAt}
              onClick={() => {
                const editingShift = employee.shifts.find(
                  (shift) => shift.id === editingShiftId,
                );
                if (editingShift) {
                  onCommand({
                    type: 'shift.update',
                    shiftId: editingShift.id,
                    shopId,
                    expectedVersion: editingShift.version,
                    startsAt: businessLocalDateTimeToIso(startsAt),
                    endsAt: businessLocalDateTimeToIso(endsAt),
                    plannedBreakMinutes: Number(breakMinutes) || 0,
                  });
                  setEditingShiftId(null);
                } else {
                  onCommand({
                    type: 'shift.create',
                    employeeId: employee.id,
                    shopId,
                    startsAt: businessLocalDateTimeToIso(startsAt),
                    endsAt: businessLocalDateTimeToIso(endsAt),
                    plannedBreakMinutes: Number(breakMinutes) || 0,
                  });
                }
              }}
            >
              {editingShiftId ? 'Save shift' : 'Add shift'}
            </button>
            {editingShiftId ? (
              <button
                className="admin-secondary-button"
                type="button"
                onClick={() => {
                  setEditingShiftId(null);
                  setStartsAt('');
                  setEndsAt('');
                  setBreakMinutes('0');
                }}
              >
                Cancel edit
              </button>
            ) : null}
          </section>

          <section className="admin-catalog-editor__section is-compact">
            <h4>Copy Previous Week</h4>
            <label className="admin-field">
              <span>Target week start</span>
              <input
                type="date"
                value={targetWeekStart}
                onChange={(event) => setTargetWeekStart(event.target.value)}
              />
            </label>
            <button
              className="admin-secondary-button"
              type="button"
              disabled={!targetWeekStart}
              onClick={() =>
                onCommand({
                  type: 'shift.copy-previous-week',
                  employeeId: employee.id,
                  shopId,
                  targetWeekStart,
                })
              }
            >
              Copy Previous Week
            </button>
          </section>
        </>
      ) : null}
    </section>
  );
}
