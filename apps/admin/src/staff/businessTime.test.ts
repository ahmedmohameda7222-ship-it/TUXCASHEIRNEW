import { describe, expect, it } from 'vitest';

import {
  BUSINESS_TIME_ZONE,
  businessDateTimeInputValue,
  businessLocalDateTimeToIso,
  formatBusinessDateTime,
} from './businessTime';

describe('Workforce business timezone', () => {
  it('uses Africa/Cairo as the canonical business timezone', () => {
    expect(BUSINESS_TIME_ZONE).toBe('Africa/Cairo');
  });

  it('converts Cairo summer local input to the correct UTC instant', () => {
    expect(businessLocalDateTimeToIso('2026-09-27T09:15')).toBe(
      '2026-09-27T06:15:00.000Z',
    );
  });

  it('converts Cairo winter local input to the correct UTC instant', () => {
    expect(businessLocalDateTimeToIso('2026-01-27T09:15')).toBe(
      '2026-01-27T07:15:00.000Z',
    );
  });

  it('formats an instant back in Cairo regardless of browser timezone', () => {
    expect(formatBusinessDateTime('2026-09-27T06:15:00.000Z')).toContain(
      '09:15',
    );
  });

  it('round-trips an instant into a datetime-local value in Cairo', () => {
    expect(businessDateTimeInputValue('2026-09-27T06:15:00.000Z')).toBe(
      '2026-09-27T09:15',
    );
  });

  it('rejects malformed local date-time input', () => {
    expect(() => businessLocalDateTimeToIso('2026-09-27 09:15')).toThrowError(
      'invalid_business_local_datetime',
    );
  });
});
