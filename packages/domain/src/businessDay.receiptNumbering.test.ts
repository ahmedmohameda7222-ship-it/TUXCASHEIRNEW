import { describe, expect, it } from 'vitest';

import {
  allocateDisplayOrderNo,
  createOpenBusinessDay,
  type OpenBusinessDay,
} from './businessDay';
import { parseEntityId, type BusinessDayId, type ShopId, type WorkerId } from './ids';
import { instant } from './time';

const createConfiguredBusinessDay = createOpenBusinessDay as unknown as (
  input: Parameters<typeof createOpenBusinessDay>[0],
  options: { readonly sequenceStart: number },
) => OpenBusinessDay;

const input = {
  id: parseEntityId<BusinessDayId>('11111111-1111-4111-8111-111111111111'),
  shopId: parseEntityId<ShopId>('22222222-2222-4222-8222-222222222222'),
  startedAt: instant('2026-09-11T21:30:00.000Z'),
  startedByWorkerId: parseEntityId<WorkerId>('33333333-3333-4333-8333-333333333333'),
};

describe('Business Day configured receipt sequence', () => {
  it('initializes the numeric allocator so the first order equals the configured sequence start', () => {
    const opened = createConfiguredBusinessDay(input, { sequenceStart: 100 });

    expect(opened.lastAllocatedDisplayOrderNo).toBe(99);
    const first = allocateDisplayOrderNo(opened);
    expect(first.displayOrderNo).toBe(100);
    const second = allocateDisplayOrderNo(first.businessDay);
    expect(second.displayOrderNo).toBe(101);
  });

  it('preserves the legacy first order number when no numbering policy is supplied', () => {
    const opened = createOpenBusinessDay(input);
    expect(allocateDisplayOrderNo(opened).displayOrderNo).toBe(1);
  });

  it('rejects unsafe sequence starts instead of creating a rewindable or invalid allocator baseline', () => {
    expect(() => createConfiguredBusinessDay(input, { sequenceStart: 0 })).toThrow(RangeError);
    expect(() => createConfiguredBusinessDay(input, { sequenceStart: 1.5 })).toThrow(RangeError);
    expect(() =>
      createConfiguredBusinessDay(input, { sequenceStart: Number.MAX_SAFE_INTEGER + 1 }),
    ).toThrow(RangeError);
  });
});
