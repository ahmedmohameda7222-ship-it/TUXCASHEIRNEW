import { describe, expect, it } from 'vitest';

import { cairoReportDay, priorReportDay, trendMatchesPeriod } from './reportDates';

describe('Cairo dashboard reporting date integrity', () => {
  it('uses the Cairo civil reporting day at the local midnight boundary', () => {
    expect(cairoReportDay(new Date('2026-10-18T20:59:59Z'))).toBe('2026-10-18');
    expect(cairoReportDay(new Date('2026-10-18T21:00:00Z'))).toBe('2026-10-19');
    expect(priorReportDay('2026-10-19', 6)).toBe('2026-10-13');
    expect(priorReportDay('2026-03-01', 6)).toBe('2026-02-23');
  });

  it('accepts genuine source dates and zero values without rewriting amounts', () => {
    const points = [
      { date: '2026-10-13', netSalesMinor: 0 },
      { date: '2026-10-19', netSalesMinor: 155000 },
    ];
    expect(trendMatchesPeriod(points, '2026-10-13', '2026-10-19')).toBe(true);
    expect(points[0].netSalesMinor).toBe(0);
    expect(points[1].netSalesMinor).toBe(155000);
  });

  it('rejects stale, future, duplicate, invalid and fabricated-calendar dates', () => {
    for (const date of ['2026-10-02', '2026-10-20', '2026-02-30', 'bad-date']) {
      expect(trendMatchesPeriod([{ date, netSalesMinor: 15000 }], '2026-10-13', '2026-10-19')).toBe(
        false,
      );
    }
    expect(
      trendMatchesPeriod(
        [
          { date: '2026-10-15', netSalesMinor: 100 },
          { date: '2026-10-15', netSalesMinor: 200 },
        ],
        '2026-10-13',
        '2026-10-19',
      ),
    ).toBe(false);
  });
});
