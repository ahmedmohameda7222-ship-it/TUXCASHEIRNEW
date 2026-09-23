import { describe, expect, it } from 'vitest';

import * as loyaltyModule from './loyaltyService';
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
  it('calculates canonical percent and free-item rewards and enforces one-order-level stacking', () => {
    const evaluatePromotionReward = (
      loyaltyModule as unknown as {
        evaluatePromotionReward?: (
          rule: PromotionRule & {
            percentBasisPoints?: number | null;
            fixedDiscountMinor?: number | null;
            freeProductId?: string | null;
            stackingPolicy?: 'ONE_ORDER_LEVEL' | 'ALLOW_CONFIGURED';
          },
          context: {
            now: string;
            shopId: string;
            channel: 'POS' | 'ONLINE';
            subtotalMinor: number;
            priorTotalUses: number;
            priorCustomerUses: number;
            productIds: readonly string[];
            categoryIds: readonly string[];
          },
        ) =>
          | { ok: true; discountMinor: number; freeProductId: string | null }
          | { ok: false; code: string };
        validatePromotionStack?: (
          rules: readonly Array<{ stackingPolicy: 'ONE_ORDER_LEVEL' | 'ALLOW_CONFIGURED' }>,
        ) => { ok: true } | { ok: false; code: string };
      }
    ).evaluatePromotionReward;
    const validatePromotionStack = (
      loyaltyModule as unknown as {
        validatePromotionStack?: (
          rules: readonly Array<{ stackingPolicy: 'ONE_ORDER_LEVEL' | 'ALLOW_CONFIGURED' }>,
        ) => { ok: true } | { ok: false; code: string };
      }
    ).validatePromotionStack;

    expect(typeof evaluatePromotionReward).toBe('function');
    expect(typeof validatePromotionStack).toBe('function');
    if (!evaluatePromotionReward || !validatePromotionStack) return;

    const context = {
      now: '2026-09-15T00:00:00.000Z',
      shopId: 'shop-1',
      channel: 'POS' as const,
      subtotalMinor: 10_000,
      priorTotalUses: 0,
      priorCustomerUses: 0,
      productIds: ['product-1'],
      categoryIds: ['category-1'],
    };

    expect(
      evaluatePromotionReward(
        {
          ...basePromotion,
          kind: 'PERCENT',
          percentBasisPoints: 2500,
          fixedDiscountMinor: null,
          freeProductId: null,
        },
        context,
      ),
    ).toEqual({ ok: true, discountMinor: 2500, freeProductId: null });

    expect(
      evaluatePromotionReward(
        {
          ...basePromotion,
          kind: 'FREE_ITEM',
          percentBasisPoints: null,
          fixedDiscountMinor: null,
          freeProductId: 'product-free',
        },
        context,
      ),
    ).toEqual({ ok: true, discountMinor: 0, freeProductId: 'product-free' });

    expect(
      validatePromotionStack([
        { stackingPolicy: 'ONE_ORDER_LEVEL' },
        { stackingPolicy: 'ONE_ORDER_LEVEL' },
      ]),
    ).toEqual({ ok: false, code: 'promotion_stacking_not_allowed' });
  });

  it('derives the approved automatic segments from canonical customer facts and configured thresholds', () => {
    const computeAutomaticSegments = (
      loyaltyModule as unknown as {
        computeAutomaticSegments?: (
          facts: {
            now: string;
            orderCount: number;
            lifetimeSpendMinor: number;
            lastOrderAt: string | null;
            deliveryOrderCount: number;
            loyaltyBalance: number;
          },
          policy: {
            vipMinOrders: number;
            vipMinSpendMinor: number;
            topSpenderMinSpendMinor: number;
            frequentDeliveryMinOrders: number;
          },
        ) => readonly string[];
      }
    ).computeAutomaticSegments;

    expect(typeof computeAutomaticSegments).toBe('function');
    if (!computeAutomaticSegments) return;

    expect(
      computeAutomaticSegments(
        {
          now: '2026-09-23T00:00:00.000Z',
          orderCount: 12,
          lifetimeSpendMinor: 150_000,
          lastOrderAt: '2026-07-20T00:00:00.000Z',
          deliveryOrderCount: 5,
          loyaltyBalance: 120,
        },
        {
          vipMinOrders: 10,
          vipMinSpendMinor: 100_000,
          topSpenderMinSpendMinor: 120_000,
          frequentDeliveryMinOrders: 4,
        },
      ),
    ).toEqual([
      'Returning',
      'VIP',
      'Inactive 30 Days',
      'Inactive 60 Days',
      'Top Spenders',
      'Frequent Delivery',
      'Loyalty Members',
    ]);

    expect(
      computeAutomaticSegments(
        {
          now: '2026-09-23T00:00:00.000Z',
          orderCount: 1,
          lifetimeSpendMinor: 2500,
          lastOrderAt: '2026-09-22T00:00:00.000Z',
          deliveryOrderCount: 0,
          loyaltyBalance: 0,
        },
        {
          vipMinOrders: 10,
          vipMinSpendMinor: 100_000,
          topSpenderMinSpendMinor: 120_000,
          frequentDeliveryMinOrders: 4,
        },
      ),
    ).toEqual(['New']);
  });

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
