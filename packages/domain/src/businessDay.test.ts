import { describe, expect, it } from 'vitest';
import { allocateDisplayOrderNo, closeBusinessDay, createOpenBusinessDay } from './businessDay';
import { parseEntityId, type BusinessDayId, type ShopId, type WorkerId } from './ids';
import { instant } from './time';

const shopId = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const workerId = parseEntityId<WorkerId>('22222222-2222-4222-8222-222222222222');
const businessDayId = parseEntityId<BusinessDayId>('33333333-3333-4333-8333-333333333333');

describe('Business Day', () => {
  it('allocates display numbers from Business Day state without calendar-date logic', () => {
    const day = createOpenBusinessDay({
      id: businessDayId,
      shopId,
      startedAt: instant('2026-08-16T13:00:00Z'),
      startedByWorkerId: workerId,
    });
    const first = allocateDisplayOrderNo(day);
    const second = allocateDisplayOrderNo(first.businessDay);

    expect(first.displayOrderNo).toBe(1);
    expect(second.displayOrderNo).toBe(2);
    expect(second.businessDay.status).toBe('OPEN');
  });

  it('can close after midnight without changing Business Day identity', () => {
    const day = createOpenBusinessDay({
      id: businessDayId,
      shopId,
      startedAt: instant('2026-08-16T13:00:00Z'),
      startedByWorkerId: workerId,
    });
    const closed = closeBusinessDay(day, instant('2026-08-17T00:30:00Z'), workerId);

    expect(closed.id).toBe(businessDayId);
    expect(closed.status).toBe('CLOSED');
  });
});
