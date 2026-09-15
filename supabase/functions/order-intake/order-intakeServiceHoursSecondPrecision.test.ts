import { describe, expect, it } from 'vitest';

import {
  isPublishedOnlineOrderingOpenAt,
  type OnlineOrderPublishedCheckoutAuthority,
} from './order-intake';

const authority = {
  shopId: '11111111-1111-4111-8111-111111111111',
  configurationVersion: 1,
  settingsVersion: 1,
  lifecycleState: 'ACTIVE',
  temporaryClosed: false,
  onlineOrdersPaused: false,
  minimumOrderMinor: 0,
  serviceChargeBps: 0,
  taxBps: 0,
  requireCustomerPhone: false,
  weeklyHours: [
    {
      serviceKind: 'ONLINE',
      dayOfWeek: 1,
      timezone: 'Africa/Cairo',
      opensLocal: '12:30:30',
      closesLocal: '12:31:30',
      active: true,
    },
  ],
  specialHours: [],
  orderTypes: [],
  paymentMethods: [],
} satisfies OnlineOrderPublishedCheckoutAuthority;

describe('published ONLINE service hours precision', () => {
  it('honors accepted opening and closing seconds in Africa/Cairo', () => {
    expect(isPublishedOnlineOrderingOpenAt(authority, new Date('2026-01-05T10:30:29.000Z'))).toBe(
      false,
    );
    expect(isPublishedOnlineOrderingOpenAt(authority, new Date('2026-01-05T10:30:30.000Z'))).toBe(
      true,
    );
    expect(isPublishedOnlineOrderingOpenAt(authority, new Date('2026-01-05T10:31:29.000Z'))).toBe(
      true,
    );
    expect(isPublishedOnlineOrderingOpenAt(authority, new Date('2026-01-05T10:31:30.000Z'))).toBe(
      false,
    );
  });
});
