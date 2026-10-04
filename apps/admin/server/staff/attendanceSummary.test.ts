import type { AttendanceCorrection, AttendanceEvent, EmployeeShift } from '@tux/admin-contracts';
import { describe, expect, it } from 'vitest';

import { buildAttendanceSummaries } from './attendanceSummary';

const employeeId = '11111111-1111-4111-8111-111111111111';
const shopId = '22222222-2222-4222-8222-222222222222';

function shift(overrides: Partial<EmployeeShift> = {}): EmployeeShift {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    employeeId,
    shopId,
    startsAt: '2026-09-27T06:00:00.000Z',
    endsAt: '2026-09-27T14:00:00.000Z',
    plannedBreakMinutes: 30,
    status: 'SCHEDULED',
    version: 1,
    sourceShiftId: null,
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z',
    ...overrides,
  };
}

function event(
  id: string,
  type: AttendanceEvent['eventType'],
  occurredAt: string,
): AttendanceEvent {
  return {
    id,
    employeeId,
    shopId,
    workerId: '44444444-4444-4444-8444-444444444444',
    workerSessionId: '55555555-5555-4555-8555-555555555555',
    eventType: type,
    occurredAt,
    createdAt: occurredAt,
  };
}

describe('Workforce attendance summary', () => {
  it('uses the latest append-only correction without mutating the original event', () => {
    const start = event(
      '66666666-6666-4666-8666-666666666666',
      'SESSION_START',
      '2026-09-27T06:20:00.000Z',
    );
    const end = event(
      '77777777-7777-4777-8777-777777777777',
      'SESSION_END',
      '2026-09-27T14:30:00.000Z',
    );
    const corrections: AttendanceCorrection[] = [
      {
        id: '88888888-8888-4888-8888-888888888888',
        employeeId,
        shopId,
        attendanceEventId: start.id,
        originalOccurredAt: start.occurredAt,
        correctedOccurredAt: '2026-09-27T06:05:00.000Z',
        reason: 'Clock-in correction',
        correctedByEmployeeId: '99999999-9999-4999-8999-999999999999',
        createdAt: '2026-09-27T15:00:00.000Z',
      },
    ];

    const [summary] = buildAttendanceSummaries({
      employeeId,
      shopId,
      shifts: [shift()],
      events: [start, end],
      corrections,
      now: new Date('2026-09-28T00:00:00.000Z'),
    });

    expect(start.occurredAt).toBe('2026-09-27T06:20:00.000Z');
    expect(summary).toMatchObject({
      scheduledStartsAt: '2026-09-27T06:00:00.000Z',
      scheduledEndsAt: '2026-09-27T14:00:00.000Z',
      actualStartsAt: '2026-09-27T06:05:00.000Z',
      actualEndsAt: '2026-09-27T14:30:00.000Z',
      plannedBreakMinutes: 30,
      workedMinutes: 475,
      lateMinutes: 5,
      leftEarlyMinutes: 0,
      overtimeMinutes: 25,
      absent: false,
    });
  });

  it('marks a past unmatched scheduled shift absent without inventing clock facts', () => {
    const [summary] = buildAttendanceSummaries({
      employeeId,
      shopId,
      shifts: [shift()],
      events: [],
      corrections: [],
      now: new Date('2026-09-28T00:00:00.000Z'),
    });

    expect(summary).toMatchObject({
      scheduledShiftId: '33333333-3333-4333-8333-333333333333',
      actualStartsAt: null,
      actualEndsAt: null,
      workedMinutes: 0,
      absent: true,
    });
  });

  it('does not label a future shift absent', () => {
    expect(
      buildAttendanceSummaries({
        employeeId,
        shopId,
        shifts: [
          shift({
            startsAt: '2026-09-29T06:00:00.000Z',
            endsAt: '2026-09-29T14:00:00.000Z',
          }),
        ],
        events: [],
        corrections: [],
        now: new Date('2026-09-28T00:00:00.000Z'),
      }),
    ).toEqual([]);
  });
});
