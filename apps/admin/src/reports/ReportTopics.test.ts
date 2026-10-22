import { describe, expect, it } from 'vitest';
import { REPORT_LABELS, REPORT_TOPICS } from './ReportFilters';

describe('report topic picker', () => {
  it('groups each supported report exactly once with the original report ID', () => {
    const grouped = REPORT_TOPICS.flatMap((topic) => topic.areas);
    expect(grouped.length).toBe(Object.keys(REPORT_LABELS).length);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect(new Set(grouped)).toEqual(new Set(Object.keys(REPORT_LABELS)));
  });
});
