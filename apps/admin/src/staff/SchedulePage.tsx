import type { EmployeeDetail } from '@tux/admin-contracts';
import { useState } from 'react';

import { AdminDialog } from '../components/overlay/AdminDialog';
import {
  businessDateTimeInputValue,
  businessLocalDateTimeToIso,
  formatBusinessDateTime,
} from './businessTime';

export type StaffCommandDraft = Readonly<Record<string, unknown>> & { readonly type: string };

function shiftStatusLabel(status: string): string {
  if (status === 'CANCELLED') return 'Cancelled';
  if (status === 'COMPLETED') return 'Completed';
  return 'Scheduled';
}

function formatDuration(minutes: number): string {
  if (minutes === 0) return 'No break';
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours > 0 ? `${hours}h ${remainder}m break` : `${remainder}m break`;
}

export function SchedulePage({
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
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [breakMinutes, setBreakMinutes] = useState('0');
  const [targetWeekStart, setTargetWeekStart] = useState('');
  const [editingShiftId, setEditingShiftId] = useState<string | null>(null);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [savingShift, setSavingShift] = useState(false);
  const [shiftError, setShiftError] = useState<string | null>(null);

  const shifts = employee.shifts.filter((shift) => shift.shopId === shopId);

  return (
    <section aria-label="Schedule">
      <h3>Schedule</h3>
      {shifts.length === 0 ? <p>No scheduled shifts for this shop.</p> : null}
      {shifts.map((shift) => (
        <article className="admin-staff-record-row" key={shift.id}>
          <span>
            <strong>{formatBusinessDateTime(shift.startsAt)}</strong>
            <small>
              {formatBusinessDateTime(shift.endsAt)} · {formatDuration(shift.plannedBreakMinutes)}
            </small>
          </span>
          <span>
            {shiftStatusLabel(shift.status)}
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
                    setShiftOpen(true);
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
          <button
            className="admin-primary-button"
            type="button"
            onClick={() => {
              setEditingShiftId(null);
              setStartsAt('');
              setEndsAt('');
              setBreakMinutes('0');
              setShiftError(null);
              setShiftOpen(true);
            }}
          >
            Add shift
          </button>
          <AdminDialog
            open={shiftOpen}
            variant="sheet"
            title={editingShiftId ? 'Edit shift' : 'Add shift'}
            description="Set the employee's working time and planned break."
            onOpenChange={(open) => {
              if (savingShift) return;
              setShiftOpen(open);
              if (!open) setEditingShiftId(null);
            }}
          >
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
            {shiftError ? <p role="alert">{shiftError}</p> : null}
            <button
              className="admin-primary-button"
              type="button"
              disabled={!startsAt || !endsAt || savingShift}
              onClick={async () => {
                setShiftError(null);
                setSavingShift(true);
                try {
                  const editingShift = employee.shifts.find((shift) => shift.id === editingShiftId);
                  const command: StaffCommandDraft = editingShift
                    ? {
                        type: 'shift.update',
                        shiftId: editingShift.id,
                        shopId,
                        expectedVersion: editingShift.version,
                        startsAt: businessLocalDateTimeToIso(startsAt),
                        endsAt: businessLocalDateTimeToIso(endsAt),
                        plannedBreakMinutes: Number(breakMinutes) || 0,
                      }
                    : {
                        type: 'shift.create',
                        employeeId: employee.id,
                        shopId,
                        startsAt: businessLocalDateTimeToIso(startsAt),
                        endsAt: businessLocalDateTimeToIso(endsAt),
                        plannedBreakMinutes: Number(breakMinutes) || 0,
                      };
                  if (onVerifiedCommand) await onVerifiedCommand(command);
                  else onCommand(command);
                  setEditingShiftId(null);
                  setShiftOpen(false);
                } catch (error) {
                  const message =
                    error instanceof Error ? error.message : 'Shift could not be saved';
                  setShiftError(message.replaceAll('_', ' '));
                } finally {
                  setSavingShift(false);
                }
              }}
            >
              {savingShift ? 'Saving…' : editingShiftId ? 'Save shift' : 'Add shift'}
            </button>
          </AdminDialog>

          <section className="admin-staff-section is-compact">
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
