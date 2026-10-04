import { describe, expect, it } from 'vitest';

import {
  calculateLateMinutes,
  calculateLeftEarlyMinutes,
  calculateOvertimeMinutes,
  calculateWorkedMinutes,
} from './timekeeping';

describe('Workforce timekeeping calculations', () => {
  it('subtracts break minutes from worked time', () => {
    expect(
      calculateWorkedMinutes({
        clockIn: '09:00',
        clockOut: '17:00',
        breakMinutes: 40,
      }),
    ).toBe(440);
  });

  it('handles a cross-midnight shift deterministically', () => {
    expect(
      calculateWorkedMinutes({
        clockIn: '22:30',
        clockOut: '06:15',
        breakMinutes: 30,
      }),
    ).toBe(435);
  });

  it('uses absolute timestamps without applying a second timezone conversion', () => {
    expect(
      calculateWorkedMinutes({
        clockIn: '2026-09-27T20:00:00+03:00',
        clockOut: '2026-09-28T04:00:00+03:00',
        breakMinutes: 20,
      }),
    ).toBe(460);
  });

  it('reports only minutes beyond the regular threshold as overtime', () => {
    expect(calculateOvertimeMinutes({ workedMinutes: 540, regularMinutes: 480 })).toBe(60);
    expect(calculateOvertimeMinutes({ workedMinutes: 420, regularMinutes: 480 })).toBe(0);
  });

  it('reports late and left-early minutes without negative values', () => {
    expect(
      calculateLateMinutes({
        scheduledStart: '2026-09-27T09:00:00+03:00',
        actualStart: '2026-09-27T09:17:00+03:00',
      }),
    ).toBe(17);
    expect(
      calculateLeftEarlyMinutes({
        scheduledEnd: '2026-09-27T17:00:00+03:00',
        actualEnd: '2026-09-27T16:42:00+03:00',
      }),
    ).toBe(18);
    expect(
      calculateLateMinutes({
        scheduledStart: '2026-09-27T09:00:00+03:00',
        actualStart: '2026-09-27T08:55:00+03:00',
      }),
    ).toBe(0);
  });
});
