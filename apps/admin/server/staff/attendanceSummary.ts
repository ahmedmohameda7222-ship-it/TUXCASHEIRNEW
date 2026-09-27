import type {
  AttendanceCorrection,
  AttendanceEvent,
  AttendanceSummary,
  EmployeeShift,
} from '@tux/admin-contracts';

import {
  calculateLateMinutes,
  calculateLeftEarlyMinutes,
  calculateOvertimeMinutes,
} from './timekeeping.js';

export type AttendanceSummaryInput = {
  readonly employeeId: string;
  readonly shopId: string;
  readonly shifts: readonly EmployeeShift[];
  readonly events: readonly AttendanceEvent[];
  readonly corrections: readonly AttendanceCorrection[];
  readonly now?: Date;
};

function minuteDifference(start: string, end: string): number {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0;
  return Math.floor((endMs - startMs) / 60_000);
}

function effectiveEventTime(
  event: AttendanceEvent,
  latestCorrectionByEvent: ReadonlyMap<string, AttendanceCorrection>,
): string {
  return latestCorrectionByEvent.get(event.id)?.correctedOccurredAt ?? event.occurredAt;
}

function latestCorrectionMap(
  corrections: readonly AttendanceCorrection[],
): ReadonlyMap<string, AttendanceCorrection> {
  const sorted = [...corrections].sort(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
  );
  const map = new Map<string, AttendanceCorrection>();
  for (const correction of sorted) {
    if (!map.has(correction.attendanceEventId)) {
      map.set(correction.attendanceEventId, correction);
    }
  }
  return map;
}

type SessionFacts = {
  workerSessionId: string;
  start: string | null;
  end: string | null;
};

function sessionFacts(
  events: readonly AttendanceEvent[],
  corrections: readonly AttendanceCorrection[],
): readonly SessionFacts[] {
  const latestCorrectionByEvent = latestCorrectionMap(corrections);
  const sessions = new Map<string, SessionFacts>();
  for (const event of events) {
    const current = sessions.get(event.workerSessionId) ?? {
      workerSessionId: event.workerSessionId,
      start: null,
      end: null,
    };
    const occurredAt = effectiveEventTime(event, latestCorrectionByEvent);
    sessions.set(event.workerSessionId, {
      ...current,
      ...(event.eventType === 'SESSION_START' ? { start: occurredAt } : { end: occurredAt }),
    });
  }
  return [...sessions.values()].sort((left, right) =>
    (left.start ?? left.end ?? '').localeCompare(right.start ?? right.end ?? ''),
  );
}

function nearestUnmatchedShift(
  start: string | null,
  shifts: readonly EmployeeShift[],
  usedShiftIds: ReadonlySet<string>,
): EmployeeShift | null {
  if (!start) return null;
  const startMs = Date.parse(start);
  let selected: EmployeeShift | null = null;
  let selectedDistance = Number.POSITIVE_INFINITY;

  for (const shift of shifts) {
    if (usedShiftIds.has(shift.id) || shift.status === 'CANCELLED') continue;
    const distance = Math.abs(startMs - Date.parse(shift.startsAt));
    if (distance <= 12 * 60 * 60 * 1000 && distance < selectedDistance) {
      selected = shift;
      selectedDistance = distance;
    }
  }
  return selected;
}

function summaryForSession(
  employeeId: string,
  shopId: string,
  facts: SessionFacts,
  shift: EmployeeShift | null,
): AttendanceSummary {
  const breakMinutes = shift?.plannedBreakMinutes ?? 0;
  const grossWorked = facts.start && facts.end ? minuteDifference(facts.start, facts.end) : 0;
  const workedMinutes = Math.max(0, grossWorked - breakMinutes);
  const scheduledGross = shift === null ? 0 : minuteDifference(shift.startsAt, shift.endsAt);
  const scheduledNet = Math.max(0, scheduledGross - breakMinutes);

  return {
    employeeId,
    shopId,
    scheduledShiftId: shift?.id ?? null,
    scheduledStartsAt: shift?.startsAt ?? null,
    scheduledEndsAt: shift?.endsAt ?? null,
    plannedBreakMinutes: breakMinutes,
    actualStartsAt: facts.start,
    actualEndsAt: facts.end,
    workedMinutes,
    lateMinutes:
      shift && facts.start
        ? calculateLateMinutes({
            scheduledStart: shift.startsAt,
            actualStart: facts.start,
          })
        : 0,
    leftEarlyMinutes:
      shift && facts.end
        ? calculateLeftEarlyMinutes({
            scheduledEnd: shift.endsAt,
            actualEnd: facts.end,
          })
        : 0,
    overtimeMinutes:
      shift === null
        ? 0
        : calculateOvertimeMinutes({
            workedMinutes,
            regularMinutes: scheduledNet,
          }),
    absent: false,
  };
}

export function buildAttendanceSummaries(
  input: AttendanceSummaryInput,
): readonly AttendanceSummary[] {
  const nowMs = (input.now ?? new Date()).getTime();
  const shifts = input.shifts
    .filter((shift) => shift.shopId === input.shopId && shift.status !== 'CANCELLED')
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  const events = input.events.filter((event) => event.shopId === input.shopId);
  const corrections = input.corrections.filter((correction) => correction.shopId === input.shopId);

  const usedShiftIds = new Set<string>();
  const summaries: AttendanceSummary[] = [];

  for (const facts of sessionFacts(events, corrections)) {
    const shift = nearestUnmatchedShift(facts.start, shifts, usedShiftIds);
    if (shift) usedShiftIds.add(shift.id);
    summaries.push(summaryForSession(input.employeeId, input.shopId, facts, shift));
  }

  for (const shift of shifts) {
    if (usedShiftIds.has(shift.id) || Date.parse(shift.endsAt) > nowMs) continue;
    summaries.push({
      employeeId: input.employeeId,
      shopId: input.shopId,
      scheduledShiftId: shift.id,
      scheduledStartsAt: shift.startsAt,
      scheduledEndsAt: shift.endsAt,
      plannedBreakMinutes: shift.plannedBreakMinutes,
      actualStartsAt: null,
      actualEndsAt: null,
      workedMinutes: 0,
      lateMinutes: 0,
      leftEarlyMinutes: 0,
      overtimeMinutes: 0,
      absent: true,
    });
  }

  return summaries.sort((left, right) =>
    (right.scheduledStartsAt ?? right.actualStartsAt ?? '').localeCompare(
      left.scheduledStartsAt ?? left.actualStartsAt ?? '',
    ),
  );
}
