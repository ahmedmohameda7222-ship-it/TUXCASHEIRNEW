import { describe, expect, it } from 'vitest';
import { toOrderTimeRange } from './orderDateRange';

describe('order date/time filtering', () => {
  it('sends ISO instants to the existing server-side paginated search', () => {
    const result = toOrderTimeRange('2026-10-11T08:30', '2026-10-12T12:15');
    expect(result.error).toBeNull();
    expect(result.from).toBe(new Date('2026-10-11T08:30').toISOString());
    expect(result.to).toBe(new Date('2026-10-12T12:15').toISOString());
  });
  it('permits independent bounds while rejecting reversed ranges', () => {
    expect(toOrderTimeRange('', '').from).toBeNull();
    expect(toOrderTimeRange('', '2026-10-12T12:15').to).not.toBeNull();
    expect(toOrderTimeRange('2026-10-13T08:30', '2026-10-12T12:15').error).toMatch(/before/i);
    expect(toOrderTimeRange('not-a-date', '').error).toMatch(/date/i);
  });
});
