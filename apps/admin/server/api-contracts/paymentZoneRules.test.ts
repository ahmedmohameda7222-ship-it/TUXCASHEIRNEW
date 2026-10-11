import type { AdminSessionPrincipal } from '@tux/admin-contracts';
import { describe, expect, it } from 'vitest';

import {
  assertPaymentZoneScope,
  paymentZoneRuleCommandSchema,
} from '../../api/admin/payment-zone-rules';

const shopId = '11111111-1111-4111-8111-111111111111';
const paymentMethodId = '22222222-2222-4222-8222-222222222222';
const deliveryZoneId = '33333333-3333-4333-8333-333333333333';

const principal: AdminSessionPrincipal = {
  employeeId: 'owner-1',
  businessId: 'business-1',
  role: 'OWNER',
  permissions: ['settings.manage'],
  shopIds: [shopId],
};

describe('Admin payment-zone policy API', () => {
  it('allows only strict versioned changes to a scoped canonical payment-zone pair', () => {
    const command = {
      type: 'payment-zone.upsert',
      shopId,
      paymentMethodId,
      deliveryZoneId,
      allowed: false,
      expectedAllowed: null,
      expectedSettingsVersion: 7,
    };
    expect(paymentZoneRuleCommandSchema.safeParse(command).success).toBe(true);
    for (const invalid of [
      { ...command, expectedSettingsVersion: -1 },
      { ...command, expectedAllowed: 'false' },
      { ...command, paymentMethodId: 'not-a-uuid' },
      { ...command, allowed: 'false' },
      { ...command, arbitrarySecret: 'token' },
    ]) {
      expect(paymentZoneRuleCommandSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('rejects managers lacking settings authority and out-of-scope shops', () => {
    expect(() => assertPaymentZoneScope(principal, shopId)).not.toThrow();
    expect(() =>
      assertPaymentZoneScope({ ...principal, permissions: [] }, shopId),
    ).toThrow('permission_forbidden');
    expect(() =>
      assertPaymentZoneScope(principal, '44444444-4444-4444-8444-444444444444'),
    ).toThrow('shop_forbidden');
  });
});
