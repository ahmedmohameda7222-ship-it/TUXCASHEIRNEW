import { describe, expect, it } from 'vitest';

import { settingsCommandSchema } from './settings';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const REASON_ID = '22222222-2222-4222-8222-222222222222';

describe('reason-code settings command contract', () => {
  it('accepts a version-fenced shop reason-code edit', () => {
    expect(
      settingsCommandSchema.safeParse({
        type: 'reason-code.upsert',
        shopId: SHOP_ID,
        reasonCodeId: REASON_ID,
        key: 'customer_changed_mind',
        family: 'CANCELLATION',
        label: 'Customer changed mind',
        active: false,
        expectedVersion: 4,
      }).success,
    ).toBe(true);
  });

  it('accepts creation only with no existing version', () => {
    expect(
      settingsCommandSchema.safeParse({
        type: 'reason-code.upsert',
        shopId: SHOP_ID,
        reasonCodeId: null,
        key: 'kitchen_delay',
        family: 'CANCELLATION',
        label: 'Kitchen delay',
        active: true,
        expectedVersion: null,
      }).success,
    ).toBe(true);
  });

  it('rejects unstable keys and unsupported families', () => {
    expect(
      settingsCommandSchema.safeParse({
        type: 'reason-code.upsert',
        shopId: SHOP_ID,
        reasonCodeId: null,
        key: 'Free text!',
        family: 'OTHER',
        label: 'Bad',
        active: true,
        expectedVersion: null,
      }).success,
    ).toBe(false);
  });
});
