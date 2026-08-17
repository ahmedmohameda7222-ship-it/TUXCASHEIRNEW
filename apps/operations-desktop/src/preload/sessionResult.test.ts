import { describe, expect, it } from 'vitest';
import { assertSessionResult } from './sessionResult';

const SHOP_ID = '10000000-0000-4000-8000-000000000001';
const DAY_ID = '20000000-0000-4000-8000-000000000001';
const WORKER_ID = '30000000-0000-4000-8000-000000000001';

describe('assertSessionResult', () => {
  it('accepts a structurally valid active session', () => {
    const value = {
      ok: true,
      value: {
        status: 'ACTIVE',
        shopId: SHOP_ID,
        businessDayId: DAY_ID,
        businessDayStartedAt: '2026-08-17T13:00:00.000Z',
        operator: { id: WORKER_ID, displayName: 'Ahmed' },
      },
    };
    expect(assertSessionResult(value)).toEqual(value);
  });

  it('accepts a known application error', () => {
    const value = {
      ok: false,
      error: { code: 'PIN_AUTH_ERROR', message: 'Invalid PIN.' },
    };
    expect(assertSessionResult(value)).toEqual(value);
  });

  it('rejects malformed success and error payloads', () => {
    expect(() => assertSessionResult({ ok: true, value: { status: 'ACTIVE' } })).toThrow(
      TypeError,
    );
    expect(() =>
      assertSessionResult({ ok: false, error: { code: 'MADE_UP', message: 'x' } }),
    ).toThrow(TypeError);
    expect(() => assertSessionResult({ ok: 'true', value: {} })).toThrow(TypeError);
  });
});
