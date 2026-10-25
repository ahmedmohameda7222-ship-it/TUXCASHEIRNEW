import { describe, expect, it } from 'vitest';
import { closedDayConvergenceCandidate } from './closedDayConvergence';

const envelope = {
  eventId: '10000000-0000-4000-8000-000000000001',
  shopId: '20000000-0000-4000-8000-000000000001',
  businessDayId: '30000000-0000-4000-8000-000000000001',
  eventType: 'BUSINESS_DAY_CLOSED',
  idempotencyKey: 'close:day',
  payloadVersion: 1,
  payload: {
    businessDay: {
      id: '30000000-0000-4000-8000-000000000001',
      shopId: '20000000-0000-4000-8000-000000000001',
      status: 'CLOSED',
      startedAt: '2026-10-25T01:00:00.000Z',
    },
  },
};

describe('already-closed Business Day convergence', () => {
  it('accepts only a matching immutable close identity', () => {
    expect(
      closedDayConvergenceCandidate(
        'TUX_BUSINESS_DAY_ALREADY_CLOSED:30000000-0000-4000-8000-000000000001',
        envelope,
        { eventType: 'BUSINESS_DAY_CLOSED' },
      ),
    ).toMatchObject({
      businessDayId: envelope.businessDayId,
      shopId: envelope.shopId,
      startedAt: '2026-10-25T01:00:00.000Z',
    });
  });

  it('rejects other conflicts and cross-day payloads', () => {
    expect(
      closedDayConvergenceCandidate('TUX_BUSINESS_DAY_SHOP_CONFLICT', envelope, {}),
    ).toBeNull();
    expect(
      closedDayConvergenceCandidate(
        'TUX_BUSINESS_DAY_ALREADY_CLOSED',
        {
          ...envelope,
          payload: { businessDay: { ...envelope.payload.businessDay, id: crypto.randomUUID() } },
        },
        { eventType: 'BUSINESS_DAY_CLOSED' },
      ),
    ).toBeNull();
  });
});
