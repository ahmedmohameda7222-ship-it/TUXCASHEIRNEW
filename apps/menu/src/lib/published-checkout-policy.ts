import type {
  PublicFulfillmentPreferenceV2,
  PublicOrderingV2,
  PublicPaymentPreferenceV2,
} from '@tux/catalog-contracts';

export type PublishedOrderTypeLabel = 'Pick up' | 'Delivery';
export type PublishedPaymentMethodLabel = 'Cash' | 'InstaPay' | 'Mixed Payment';

export interface PublishedCheckoutPolicy {
  available: boolean;
  minimumOrderMinor: number;
  serviceChargeBps: number;
  taxBps: number;
  orderTypes: PublishedOrderTypeLabel[];
  paymentMethods: PublishedPaymentMethodLabel[];
}

export type CheckoutBlockReason = 'unavailable' | 'minimum_order';

const orderTypeLabel: Record<PublicFulfillmentPreferenceV2, PublishedOrderTypeLabel> = {
  PICKUP: 'Pick up',
  DELIVERY: 'Delivery',
};

const paymentMethodLabel: Record<PublicPaymentPreferenceV2, PublishedPaymentMethodLabel> = {
  CASH: 'Cash',
  INSTAPAY: 'InstaPay',
  MIXED: 'Mixed Payment',
};

export function projectPublishedCheckoutPolicy(
  ordering: PublicOrderingV2,
): PublishedCheckoutPolicy {
  return {
    available: ordering.available,
    minimumOrderMinor: ordering.minimumOrderMinor,
    serviceChargeBps: ordering.serviceChargeBps ?? 0,
    taxBps: ordering.taxBps ?? 0,
    orderTypes: ordering.fulfillmentPreferences.map((preference) => orderTypeLabel[preference]),
    paymentMethods: ordering.paymentPreferences.map((preference) => paymentMethodLabel[preference]),
  };
}

export function cartTotalMinor(totalMajor: number): number {
  return Math.round(totalMajor * 100);
}

function applyBasisPoints(baseMinor: number, basisPoints: number): number {
  if (!Number.isSafeInteger(baseMinor) || baseMinor < 0)
    throw new Error('checkout_estimate_invalid_base');
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000)
    throw new Error('checkout_estimate_invalid_rate');
  const rounded = (BigInt(baseMinor) * BigInt(basisPoints) + 5_000n) / 10_000n;
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('checkout_estimate_overflow');
  return Number(rounded);
}

export interface PublishedCheckoutEstimate {
  itemsSubtotalMinor: number;
  serviceChargeMinor: number;
  taxMinor: number;
  totalMinor: number;
}

export function calculatePublishedCheckoutEstimate(
  policy: PublishedCheckoutPolicy,
  cartTotalMajor: number,
): PublishedCheckoutEstimate {
  const itemsSubtotalMinor = cartTotalMinor(cartTotalMajor);
  const serviceChargeMinor = applyBasisPoints(itemsSubtotalMinor, policy.serviceChargeBps);
  const preTaxMinor = itemsSubtotalMinor + serviceChargeMinor;
  if (!Number.isSafeInteger(preTaxMinor)) throw new Error('checkout_estimate_overflow');
  const taxMinor = applyBasisPoints(preTaxMinor, policy.taxBps);
  const totalMinor = preTaxMinor + taxMinor;
  if (!Number.isSafeInteger(totalMinor)) throw new Error('checkout_estimate_overflow');
  return { itemsSubtotalMinor, serviceChargeMinor, taxMinor, totalMinor };
}

export function checkoutBlockReason(
  policy: PublishedCheckoutPolicy,
  cartTotalMajor: number,
): CheckoutBlockReason | null {
  if (!policy.available) return 'unavailable';
  if (cartTotalMinor(cartTotalMajor) < policy.minimumOrderMinor) return 'minimum_order';
  return null;
}
