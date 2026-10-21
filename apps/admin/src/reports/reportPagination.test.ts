import { describe, expect, it } from 'vitest';

import { reportPaginationLabel } from './ReportView';

describe('report pagination under empty and filtered data', () => {
  it('never renders 1–0 when the result is empty', () => {
    expect(reportPaginationLabel(0, 0, 0)).toBe('0 results');
    expect(reportPaginationLabel(50, 0, 120)).toBe('No rows on this page');
  });

  it('uses the actual page offset for partial and full pages', () => {
    expect(reportPaginationLabel(0, 50, 120)).toBe('Showing 1–50 of 120');
    expect(reportPaginationLabel(50, 7, 57)).toBe('Showing 51–57 of 57');
  });
});
