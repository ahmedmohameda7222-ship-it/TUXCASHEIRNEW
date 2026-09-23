export type PromotionKind = 'PERCENT' | 'FIXED' | 'FREE_ITEM';
export type PromotionChannel = 'POS' | 'ONLINE' | 'BOTH';

export interface PromotionRule {
  readonly id: string;
  readonly kind: PromotionKind;
  readonly active: boolean;
  readonly valueMinor: number | null;
  readonly percentBasisPoints?: number | null;
  readonly fixedDiscountMinor?: number | null;
  readonly freeProductId?: string | null;
  readonly stackingPolicy?: 'ONE_ORDER_LEVEL' | 'ALLOW_CONFIGURED';
  readonly minimumOrderMinor: number;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly shopIds: readonly string[];
  readonly channel: PromotionChannel;
  readonly totalUsageLimit: number | null;
  readonly perCustomerUsageLimit: number | null;
  readonly productIds: readonly string[];
  readonly categoryIds: readonly string[];
}

export interface PromotionEvaluationContext {
  readonly now: string;
  readonly shopId: string;
  readonly channel: Exclude<PromotionChannel, 'BOTH'>;
  readonly subtotalMinor: number;
  readonly priorTotalUses: number;
  readonly priorCustomerUses: number;
  readonly productIds: readonly string[];
  readonly categoryIds: readonly string[];
}

export type PromotionValidationCode =
  | 'promotion_inactive'
  | 'promotion_not_started'
  | 'promotion_expired'
  | 'promotion_shop_mismatch'
  | 'promotion_channel_mismatch'
  | 'minimum_order_not_met'
  | 'total_usage_limit_reached'
  | 'customer_usage_limit_reached'
  | 'promotion_product_mismatch'
  | 'promotion_category_mismatch';

export type PromotionValidationResult =
  { readonly ok: true } | { readonly ok: false; readonly code: PromotionValidationCode };

export type RedemptionValidationResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: 'loyalty_disabled' | 'minimum_redemption_not_met' | 'invalid_redemption';
    };

function assertNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer.`);
  }
}

export function applyFixedDiscount(input: {
  readonly subtotalMinor: number;
  readonly discountMinor: number;
}): number {
  assertNonNegativeSafeInteger(input.subtotalMinor, 'Promotion subtotal');
  assertNonNegativeSafeInteger(input.discountMinor, 'Promotion discount');
  return Math.max(0, input.subtotalMinor - input.discountMinor);
}

export function validateRedemption(input: {
  readonly points: number;
  readonly minimumPoints: number;
  readonly enabled: boolean;
}): RedemptionValidationResult {
  if (!input.enabled) return { ok: false, code: 'loyalty_disabled' };
  if (!Number.isSafeInteger(input.points) || input.points <= 0) {
    return { ok: false, code: 'invalid_redemption' };
  }
  if (!Number.isSafeInteger(input.minimumPoints) || input.minimumPoints < 0) {
    return { ok: false, code: 'invalid_redemption' };
  }
  if (input.points < input.minimumPoints) {
    return { ok: false, code: 'minimum_redemption_not_met' };
  }
  return { ok: true };
}

function overlaps(required: readonly string[], actual: readonly string[]): boolean {
  if (required.length === 0) return true;
  const actualSet = new Set(actual);
  return required.some((value) => actualSet.has(value));
}

export function validatePromotion(
  rule: PromotionRule,
  context: PromotionEvaluationContext,
): PromotionValidationResult {
  if (!rule.active) return { ok: false, code: 'promotion_inactive' };

  const now = Date.parse(context.now);
  const startsAt = rule.startsAt === null ? null : Date.parse(rule.startsAt);
  const endsAt = rule.endsAt === null ? null : Date.parse(rule.endsAt);
  if (!Number.isFinite(now)) throw new RangeError('Promotion evaluation time must be valid.');
  if (startsAt !== null && (!Number.isFinite(startsAt) || now < startsAt)) {
    return { ok: false, code: 'promotion_not_started' };
  }
  if (endsAt !== null && (!Number.isFinite(endsAt) || now >= endsAt)) {
    return { ok: false, code: 'promotion_expired' };
  }

  if (rule.shopIds.length > 0 && !rule.shopIds.includes(context.shopId)) {
    return { ok: false, code: 'promotion_shop_mismatch' };
  }
  if (rule.channel !== 'BOTH' && rule.channel !== context.channel) {
    return { ok: false, code: 'promotion_channel_mismatch' };
  }

  assertNonNegativeSafeInteger(context.subtotalMinor, 'Promotion subtotal');
  assertNonNegativeSafeInteger(rule.minimumOrderMinor, 'Promotion minimum order');
  if (context.subtotalMinor < rule.minimumOrderMinor) {
    return { ok: false, code: 'minimum_order_not_met' };
  }

  assertNonNegativeSafeInteger(context.priorTotalUses, 'Promotion total usage');
  assertNonNegativeSafeInteger(context.priorCustomerUses, 'Promotion customer usage');
  if (rule.totalUsageLimit !== null) {
    assertNonNegativeSafeInteger(rule.totalUsageLimit, 'Promotion total usage limit');
    if (context.priorTotalUses >= rule.totalUsageLimit) {
      return { ok: false, code: 'total_usage_limit_reached' };
    }
  }
  if (rule.perCustomerUsageLimit !== null) {
    assertNonNegativeSafeInteger(rule.perCustomerUsageLimit, 'Promotion customer usage limit');
    if (context.priorCustomerUses >= rule.perCustomerUsageLimit) {
      return { ok: false, code: 'customer_usage_limit_reached' };
    }
  }

  if (!overlaps(rule.productIds, context.productIds)) {
    return { ok: false, code: 'promotion_product_mismatch' };
  }
  if (!overlaps(rule.categoryIds, context.categoryIds)) {
    return { ok: false, code: 'promotion_category_mismatch' };
  }
  return { ok: true };
}

export type PromotionRewardResult =
  | {
      readonly ok: true;
      readonly discountMinor: number;
      readonly freeProductId: string | null;
    }
  | {
      readonly ok: false;
      readonly code: PromotionValidationCode | 'promotion_invalid_configuration';
    };

export function evaluatePromotionReward(
  rule: PromotionRule,
  context: PromotionEvaluationContext,
): PromotionRewardResult {
  const validation = validatePromotion(rule, context);
  if (!validation.ok) return validation;

  switch (rule.kind) {
    case 'PERCENT': {
      const basisPoints = rule.percentBasisPoints;
      if (
        basisPoints === null ||
        basisPoints === undefined ||
        !Number.isSafeInteger(basisPoints) ||
        basisPoints <= 0 ||
        basisPoints > 10_000
      ) {
        return { ok: false, code: 'promotion_invalid_configuration' };
      }
      const rawDiscount = Math.floor((context.subtotalMinor * basisPoints) / 10_000);
      if (!Number.isSafeInteger(rawDiscount) || rawDiscount < 0) {
        return { ok: false, code: 'promotion_invalid_configuration' };
      }
      return {
        ok: true,
        discountMinor: Math.min(context.subtotalMinor, rawDiscount),
        freeProductId: null,
      };
    }
    case 'FIXED': {
      const discount = rule.fixedDiscountMinor ?? rule.valueMinor;
      if (discount === null || !Number.isSafeInteger(discount) || discount < 0) {
        return { ok: false, code: 'promotion_invalid_configuration' };
      }
      assertNonNegativeSafeInteger(context.subtotalMinor, 'Promotion subtotal');
      return {
        ok: true,
        discountMinor: Math.min(context.subtotalMinor, discount),
        freeProductId: null,
      };
    }
    case 'FREE_ITEM': {
      const freeProductId = rule.freeProductId;
      if (
        freeProductId === null ||
        freeProductId === undefined ||
        freeProductId.trim().length === 0
      ) {
        return { ok: false, code: 'promotion_invalid_configuration' };
      }
      return { ok: true, discountMinor: 0, freeProductId };
    }
  }
}

export function validatePromotionStack(
  rules: readonly Pick<PromotionRule, 'stackingPolicy'>[],
):
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'promotion_stacking_not_allowed' } {
  if (rules.length <= 1) return { ok: true };
  const allExplicitlyStackable = rules.every(
    (rule) => rule.stackingPolicy === 'ALLOW_CONFIGURED',
  );
  return allExplicitlyStackable
    ? { ok: true }
    : { ok: false, code: 'promotion_stacking_not_allowed' };
}

export interface CustomerSegmentFacts {
  readonly now: string;
  readonly orderCount: number;
  readonly lifetimeSpendMinor: number;
  readonly lastOrderAt: string | null;
  readonly deliveryOrderCount: number;
  readonly loyaltyBalance: number;
}

export interface CustomerSegmentPolicy {
  readonly vipMinOrders: number;
  readonly vipMinSpendMinor: number;
  readonly topSpenderMinSpendMinor: number;
  readonly frequentDeliveryMinOrders: number;
}

export type AutomaticCustomerSegment =
  | 'New'
  | 'Returning'
  | 'VIP'
  | 'Inactive 30 Days'
  | 'Inactive 60 Days'
  | 'Top Spenders'
  | 'Frequent Delivery'
  | 'Loyalty Members';

function elapsedDays(now: string, previous: string): number {
  const nowMs = Date.parse(now);
  const previousMs = Date.parse(previous);
  if (!Number.isFinite(nowMs) || !Number.isFinite(previousMs) || previousMs > nowMs) {
    throw new RangeError('Customer segment timestamps must be valid and ordered.');
  }
  return Math.floor((nowMs - previousMs) / 86_400_000);
}

export function computeAutomaticSegments(
  facts: CustomerSegmentFacts,
  policy: CustomerSegmentPolicy,
): readonly AutomaticCustomerSegment[] {
  for (const [label, value] of [
    ['Order count', facts.orderCount],
    ['Lifetime spend', facts.lifetimeSpendMinor],
    ['Delivery order count', facts.deliveryOrderCount],
    ['Loyalty balance', facts.loyaltyBalance],
    ['VIP minimum orders', policy.vipMinOrders],
    ['VIP minimum spend', policy.vipMinSpendMinor],
    ['Top spender minimum spend', policy.topSpenderMinSpendMinor],
    ['Frequent delivery minimum orders', policy.frequentDeliveryMinOrders],
  ] as const) {
    assertNonNegativeSafeInteger(value, label);
  }

  const segments: AutomaticCustomerSegment[] = [];
  if (facts.orderCount <= 1) segments.push('New');
  if (facts.orderCount >= 2) segments.push('Returning');

  if (
    facts.orderCount >= policy.vipMinOrders &&
    facts.lifetimeSpendMinor >= policy.vipMinSpendMinor
  ) {
    segments.push('VIP');
  }

  if (facts.lastOrderAt !== null) {
    const inactiveDays = elapsedDays(facts.now, facts.lastOrderAt);
    if (inactiveDays >= 30) segments.push('Inactive 30 Days');
    if (inactiveDays >= 60) segments.push('Inactive 60 Days');
  }

  if (facts.lifetimeSpendMinor >= policy.topSpenderMinSpendMinor) {
    segments.push('Top Spenders');
  }
  if (facts.deliveryOrderCount >= policy.frequentDeliveryMinOrders) {
    segments.push('Frequent Delivery');
  }
  if (facts.loyaltyBalance > 0) {
    segments.push('Loyalty Members');
  }

  return segments;
}
