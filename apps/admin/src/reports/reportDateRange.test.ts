import { describe, expect, it } from 'vitest';

import { validReportDateRange } from './reportDateRange';

describe('report range safety', () => {
  it('accepts equal dates and a bounded ascending Cairo calendar range', () => {
    expect(validReportDateRange('2026-10-26', '2026-10-26')).toBe(true);
    expect(validReportDateRange('2026-10-01', '2026-10-26')).toBe(true);
  });

  it('blocks reversed and invalid dates before querying', () => {
    expect(validReportDateRange('2026-10-26', '2026-10-01')).toBe(false);
    expect(validReportDateRange('2026-02-30', '2026-03-01')).toBe(false);
    expect(validReportDateRange('', '2026-10-26')).toBe(false);
  });

  it('blocks a report exceeding the trusted server 730-day budget', () => {
    expect(validReportDateRange('2020-01-01', '2026-10-26')).toBe(false);
  });
});
