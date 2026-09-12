import { describe, expect, it } from 'vitest';

import { catalogCommandSchema, catalogViewSchema } from './catalog';

const shopId = 'c5579c9a-b2f2-5aa2-b1ed-a3a9b2492b46';
const ruleId = '11111111-1111-4111-8111-111111111111';
const masterProductId = '22222222-2222-4222-8222-222222222222';

describe('Admin recurring catalog API contract', () => {
  it('accepts the recurring availability view', () => {
    expect(catalogViewSchema.safeParse('recurring-availability').success).toBe(true);
    expect(catalogViewSchema.safeParse('unknown').success).toBe(false);
  });

  it('accepts a strict recurring availability save command', () => {
    const parsed = catalogCommandSchema.safeParse({
      type: 'availability.recurring.save',
      shopId,
      ruleId,
      masterProductId,
      daysOfWeek: [5],
      startLocal: '22:00',
      endLocal: '02:00',
      available: true,
      active: false,
      expectedVersion: 3,
    });

    expect(parsed.success).toBe(true);
  });

  it('rejects invalid recurring days and non-Cairo wall-clock shapes before the service', () => {
    expect(
      catalogCommandSchema.safeParse({
        type: 'availability.recurring.save',
        shopId,
        ruleId: null,
        masterProductId,
        daysOfWeek: [7],
        startLocal: '10:00',
        endLocal: '14:00',
        available: true,
        active: true,
        expectedVersion: null,
      }).success,
    ).toBe(false);

    expect(
      catalogCommandSchema.safeParse({
        type: 'availability.recurring.save',
        shopId,
        ruleId,
        masterProductId,
        daysOfWeek: [1, 2],
        startLocal: '2026-09-11T10:00Z',
        endLocal: '14:00',
        available: true,
        active: true,
        expectedVersion: 3,
      }).success,
    ).toBe(false);
  });
});
