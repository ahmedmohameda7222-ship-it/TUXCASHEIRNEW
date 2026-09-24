import { describe, expect, it } from 'vitest';

import {
  applyFixedDiscount,
  validatePromotion,
  validateRedemption,
  type PromotionRule,
} from './loyaltyService';

const basePromotion: PromotionRule = {
  id: 'promo-1',
  kind: 'FIXED',
  active: true,
  valueMinor: 500,
  minimumOrderMinor: 1000,
  startsAt: '2026-09-01T00:00:00.000Z',
  endsAt: '2026-10-01T00:00:00.000Z',
  shopIds: ['shop-1'],
  channel: 'BOTH',
  totalUsageLimit: null,
  perCustomerUsageLimit: null,
  productIds: [],
  categoryIds: [],
};

describe('loyalty and promotion rules', () => {
  it('never allows a fixed promotion to make the payable subtotal negative', () => {
    expect(applyFixedDiscount({ subtotalMinor: 1000, discountMinor: 1500 })).toBe(0);
  });

  it('rejects loyalty redemption below the configured minimum', () => {
    expect(validateRedemption({ points: 80, minimumPoints: 100, enabled: true })).toEqual({
      ok: false,
      code: 'minimum_redemption_not_met',
    });
  });

  it('rejects an expired promotion and a customer over their usage limit', () => {
    expect(
      validatePromotion(basePromotion, {
        now: '2026-10-02T00:00:00.000Z',
        shopId: 'shop-1',
        channel: 'POS',
        subtotalMinor: 2000,
        priorTotalUses: 0,
        priorCustomerUses: 0,
        productIds: [],
        categoryIds: [],
      }),
    ).toEqual({ ok: false, code: 'promotion_expired' });

    expect(
      validatePromotion(
        { ...basePromotion, perCustomerUsageLimit: 1 },
        {
          now: '2026-09-15T00:00:00.000Z',
          shopId: 'shop-1',
          channel: 'ONLINE',
          subtotalMinor: 2000,
          priorTotalUses: 0,
          priorCustomerUses: 1,
          productIds: [],
          categoryIds: [],
        },
      ),
    ).toEqual({ ok: false, code: 'customer_usage_limit_reached' });
  });

  it('enforces shop and channel scope from the canonical rule', () => {
    expect(
      validatePromotion(
        { ...basePromotion, channel: 'ONLINE' },
        {
          now: '2026-09-15T00:00:00.000Z',
          shopId: 'shop-2',
          channel: 'POS',
          subtotalMinor: 2000,
          priorTotalUses: 0,
          priorCustomerUses: 0,
          productIds: [],
          categoryIds: [],
        },
      ),
    ).toEqual({ ok: false, code: 'promotion_shop_mismatch' });

    expect(
      validatePromotion(
        { ...basePromotion, channel: 'ONLINE' },
        {
          now: '2026-09-15T00:00:00.000Z',
          shopId: 'shop-1',
          channel: 'POS',
          subtotalMinor: 2000,
          priorTotalUses: 0,
          priorCustomerUses: 0,
          productIds: [],
          categoryIds: [],
        },
      ),
    ).toEqual({ ok: false, code: 'promotion_channel_mismatch' });
  });
});
