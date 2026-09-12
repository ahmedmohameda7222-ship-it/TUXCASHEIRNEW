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
    orderTypes: ordering.fulfillmentPreferences.map((preference) => orderTypeLabel[preference]),
    paymentMethods: ordering.paymentPreferences.map((preference) => paymentMethodLabel[preference]),
  };
}

export function cartTotalMinor(totalMajor: number): number {
  return Math.round(totalMajor * 100);
}

export function checkoutBlockReason(
  policy: PublishedCheckoutPolicy,
  cartTotalMajor: number,
): CheckoutBlockReason | null {
  if (!policy.available) return 'unavailable';
  if (cartTotalMinor(cartTotalMajor) < policy.minimumOrderMinor) return 'minimum_order';
  return null;
}
