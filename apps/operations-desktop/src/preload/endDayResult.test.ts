import { describe, expect, it } from 'vitest';
import { assertEndDayGateResult } from './endDayResult';

const dayId = '22222222-2222-4222-8222-222222222222';

describe('End Day preload parked gate', () => {
  it('accepts PARKED_DRAFTS_BLOCKED only with a positive safe parked count', () => {
    expect(
      assertEndDayGateResult({
        ok: true,
        value: { kind: 'PARKED_DRAFTS_BLOCKED', businessDayId: dayId, parkedDraftCount: 2 },
      }),
    ).toEqual({
      ok: true,
      value: { kind: 'PARKED_DRAFTS_BLOCKED', businessDayId: dayId, parkedDraftCount: 2 },
    });
    expect(() =>
      assertEndDayGateResult({
        ok: true,
        value: { kind: 'PARKED_DRAFTS_BLOCKED', businessDayId: dayId, parkedDraftCount: 0 },
      }),
    ).toThrow(TypeError);
  });
});
