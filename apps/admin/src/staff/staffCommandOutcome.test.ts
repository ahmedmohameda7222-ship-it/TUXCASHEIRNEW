import { describe, expect, it } from 'vitest';

import { assertStaffCommandOutcome } from './staffCommandOutcome';

describe('staff command outcome', () => {
  it('accepts confirmed applied and pending-approval replies without changing them', () => {
    const applied = { ok: true as const, employeeId: 'employee-1', state: 'APPLIED' as const };
    const pending = {
      ok: true as const,
      employeeId: 'employee-1',
      state: 'PENDING_APPROVAL' as const,
    };
    expect(assertStaffCommandOutcome(applied)).toBe(applied);
    expect(assertStaffCommandOutcome(pending)).toBe(pending);
  });

  it('treats HTTP-200 application-level rejection as failure, never success', () => {
    expect(() => assertStaffCommandOutcome({ ok: false, code: 'shop_forbidden' })).toThrow(
      'shop_forbidden',
    );
    expect(() => assertStaffCommandOutcome({ ok: false, code: 'stale_profile_version' })).toThrow(
      'stale_profile_version',
    );
  });
});
