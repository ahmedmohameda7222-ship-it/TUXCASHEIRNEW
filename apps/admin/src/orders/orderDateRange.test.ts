import { describe, expect, it } from 'vitest';
import { toOrderTimeRange } from './orderDateRange';

describe('order date/time filtering', () => {
  it('interprets datetime-local as Egypt/Cairo wall time independently of browser timezone', () => {
    const winter = toOrderTimeRange('2026-01-15T08:30', '2026-01-15T12:15');
    expect(winter).toEqual({
      from: '2026-01-15T06:30:00.000Z',
      to: '2026-01-15T10:15:00.000Z',
      error: null,
    });
    const summer = toOrderTimeRange('2026-07-15T08:30', '2026-07-15T12:15');
    expect(summer).toEqual({
      from: '2026-07-15T05:30:00.000Z',
      to: '2026-07-15T09:15:00.000Z',
      error: null,
    });
  });

  it('permits independent bounds while rejecting reversed ranges', () => {
    expect(toOrderTimeRange('', '').from).toBeNull();
    expect(toOrderTimeRange('', '2026-10-12T12:15').to).not.toBeNull();
    expect(toOrderTimeRange('2026-10-13T08:30', '2026-10-12T12:15').error).toMatch(
      /before/i,
    );
    expect(toOrderTimeRange('not-a-date', '').error).toMatch(/date/i);
  });

  it('rejects invalid and nonexistent Cairo wall times rather than silently shifting them', () => {
    for (const invalid of [
      '2026-02-31T08:30',
      '2026-04-24T00:30',
      '2026-01-15T24:00',
      '2026-01-15T08:65',
    ]) {
      expect(toOrderTimeRange(invalid, '').error).toMatch(/valid date/i);
    }
  });

  it('chooses the earlier occurrence of a repeated Cairo clock hour deterministically', () => {
    const result = toOrderTimeRange('2026-10-29T23:30', '');
    expect(result.from).toBe('2026-10-29T20:30:00.000Z');
    expect(result.error).toBeNull();
  });
});
