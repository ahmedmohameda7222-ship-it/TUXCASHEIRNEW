import { describe, expect, it } from 'vitest';

import { validReportTargetPeriod, matchingTargetForPeriod } from './reportTargetPeriod';

describe('R2 report target window integrity', () => {
  it('rejects reversed, malformed, and overlarge target periods', () => {
    expect(validReportTargetPeriod('2026-10-26', '2026-10-01')).toBe(false);
    expect(validReportTargetPeriod('2026-02-30', '2026-03-01')).toBe(false);
    expect(validReportTargetPeriod('2026-10-01', '2026-10-31')).toBe(true);
  });

  it('only updates a target matching shop, metric and exact period', () => {
    const targets = [
      { id: 'a', shopId: 'shop-a', metric: 'NET_SALES', periodStart: '2026-10-01', periodEnd: '2026-10-07', version: 4 },
      { id: 'b', shopId: 'shop-a', metric: 'NET_SALES', periodStart: '2026-10-08', periodEnd: '2026-10-14', version: 5 },
      { id: 'c', shopId: 'shop-b', metric: 'NET_SALES', periodStart: '2026-10-01', periodEnd: '2026-10-07', version: 2 },
    ] as const;
    expect(matchingTargetForPeriod(targets, 'shop-a', 'NET_SALES', '2026-10-08', '2026-10-14')?.id).toBe('b');
    expect(matchingTargetForPeriod(targets, 'shop-a', 'NET_SALES', '2026-10-15', '2026-10-21')).toBeUndefined();
  });
});
