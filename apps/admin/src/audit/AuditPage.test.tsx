import { describe, expect, it } from 'vitest';

import * as auditPageModule from './AuditPage';

function cairoParts(iso: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  return Object.fromEntries(
    formatter
      .formatToParts(new Date(iso))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
}

describe('AuditPage date filtering', () => {
  it('converts selected business dates to Africa/Cairo start and end instants', () => {
    const boundary = (auditPageModule as Record<string, unknown>)['cairoDateBoundary'];
    expect(typeof boundary).toBe('function');
    if (typeof boundary !== 'function') return;

    const convert = boundary as (value: string, endOfDay: boolean) => string | null;
    const start = convert('2026-09-17', false);
    const end = convert('2026-09-17', true);
    const nextStart = convert('2026-09-18', false);

    expect(start).not.toBeNull();
    expect(end).not.toBeNull();
    expect(nextStart).not.toBeNull();
    if (!start || !end || !nextStart) return;

    expect(cairoParts(start)).toEqual(
      expect.objectContaining({
        year: '2026',
        month: '09',
        day: '17',
        hour: '00',
        minute: '00',
        second: '00',
      }),
    );
    expect(new Date(end).getTime() + 1).toBe(new Date(nextStart).getTime());
  });
});
