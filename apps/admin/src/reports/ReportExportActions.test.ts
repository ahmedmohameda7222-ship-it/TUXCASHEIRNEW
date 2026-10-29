import { describe, expect, it } from 'vitest';

import { validReportExportRange } from './ReportExportActions';

describe('Reports PDF date guard', () => {
  it('accepts a real one-day and inclusive 90-day period', () => {
    expect(validReportExportRange('2026-10-29', '2026-10-29')).toBe(true);
    expect(validReportExportRange('2026-08-01', '2026-10-29')).toBe(true);
  });

  it('blocks reversed dates, malformed days, and 91-day ranges', () => {
    expect(validReportExportRange('2026-10-29', '2026-10-28')).toBe(false);
    expect(validReportExportRange('2026-02-30', '2026-03-01')).toBe(false);
    expect(validReportExportRange('2026-07-31', '2026-10-29')).toBe(false);
  });
});
