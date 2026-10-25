import { describe, expect, it } from 'vitest';
import { cairoCalendarDayRange } from './cairoCalendarDay';

describe('Cairo calendar date filtering', () => {
  it('maps an Egyptian summer day to UTC+03:00', () => {
    expect(cairoCalendarDayRange('2026-10-25')).toEqual({
      from: '2026-10-24T21:00:00.000Z',
      to: '2026-10-25T20:59:59.999Z',
    });
  });

  it('maps an Egyptian winter day to UTC+02:00', () => {
    expect(cairoCalendarDayRange('2026-11-02')).toEqual({
      from: '2026-11-01T22:00:00.000Z',
      to: '2026-11-02T21:59:59.999Z',
    });
  });

  it('rejects invalid calendar dates', () => {
    expect(cairoCalendarDayRange('2026-02-30')).toBeNull();
    expect(cairoCalendarDayRange('hello')).toBeNull();
  });
});
