import type { OperationsConfigurationSnapshot, OrderType } from './catalog';
import { DomainInvariantError } from './errors';
import type { OrderDraft } from './orderDraft';
import { preparePaymentParts } from './payment';
import { normalizeEgyptianPhone } from './phone';
import { calculateOrderPricing, type OrderPricing } from './pricing';

export type OrderValidationPath =
  | 'businessDay'
  | 'operator'
  | 'cart'
  | `line:${string}`
  | 'orderType'
  | 'delivery.phone'
  | 'delivery.name'
  | 'delivery.zone'
  | 'delivery.address'
  | 'discount'
  | 'payment';

export interface OrderValidationIssue {
  readonly path: OrderValidationPath;
  readonly code: string;
  readonly message: string;
}

export interface ValidatedOrderDraft {
  readonly orderType: OrderType;
  readonly pricing: OrderPricing;
  readonly normalizedDeliveryPhone: string | null;
}

export type OrderDraftValidationResult =
  | { readonly valid: true; readonly value: ValidatedOrderDraft }
  | { readonly valid: false; readonly issues: readonly OrderValidationIssue[] };

export function validateOrderDraft(
  draft: OrderDraft,
  configuration: OperationsConfigurationSnapshot,
): OrderDraftValidationResult {
  const issues: OrderValidationIssue[] = [];

  if (draft.shopId !== configuration.shopId) {
    issues.push({
      path: 'cart',
      code: 'SHOP_MISMATCH',
      message: 'Draft shop does not match configuration.',
    });
  }
  if (draft.checkoutIntentKey.trim().length === 0) {
    issues.push({ path: 'cart', code: 'MISSING_INTENT', message: 'Checkout intent is missing.' });
  }
  if (draft.lines.length === 0) {
    issues.push({ path: 'cart', code: 'EMPTY_CART', message: 'Choose at least one item.' });
  }

  const orderType = configuration.orderTypes.find(
    (candidate) => candidate.id === draft.orderTypeId && candidate.active,
  );
  if (orderType === undefined) {
    issues.push({
      path: 'orderType',
      code: 'ORDER_TYPE_REQUIRED',
      message: 'Select an available order type.',
    });
  }

  for (const line of draft.lines) {
    const product = configuration.products.find((candidate) => candidate.id === line.productId);
    if (product === undefined) {
      issues.push({
        path: `line:${line.id}`,
        code: 'PRODUCT_MISSING',
        message: `${line.productName} is no longer available in the local catalog.`,
      });
      continue;
    }
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
      issues.push({
        path: `line:${line.id}`,
        code: 'INVALID_QUANTITY',
        message: `${line.productName} has an invalid quantity.`,
      });
    }
    if (product.isCombo && line.comboBeverages.length !== line.quantity) {
      issues.push({
        path: `line:${line.id}`,
        code: 'COMBO_BEVERAGE_REQUIRED',
        message: `Choose one included beverage for each ${line.productName} combo.`,
      });
    }
    if (!product.isCombo && line.comboBeverages.length !== 0) {
      issues.push({
        path: `line:${line.id}`,
        code: 'UNEXPECTED_COMBO_BEVERAGE',
        message: `${line.productName} cannot contain combo beverage selections.`,
      });
    }
  }

  let normalizedDeliveryPhone: string | null = null;
  if (orderType?.behavior === 'DELIVERY') {
    const phone = normalizeEgyptianPhone(
      draft.delivery.displayPhone || draft.delivery.normalizedPhone,
    );
    if (!phone.valid) {
      issues.push({
        path: 'delivery.phone',
        code: 'DELIVERY_PHONE_REQUIRED',
        message: 'Enter a valid Egyptian phone number.',
      });
    } else {
      normalizedDeliveryPhone = phone.normalizedPhone;
    }
    if (draft.delivery.customerName.trim().length === 0) {
      issues.push({
        path: 'delivery.name',
        code: 'DELIVERY_NAME_REQUIRED',
        message: 'Customer Name is required.',
      });
    }
    if (draft.delivery.zoneId === null) {
      issues.push({
        path: 'delivery.zone',
        code: 'DELIVERY_ZONE_REQUIRED',
        message: 'Delivery Zone is required.',
      });
    }
    if (draft.delivery.address.trim().length === 0) {
      issues.push({
        path: 'delivery.address',
        code: 'DELIVERY_ADDRESS_REQUIRED',
        message: 'Full address is required.',
      });
    }
  }

  const deliveryFeeMinor =
    orderType?.behavior === 'DELIVERY'
      ? draft.delivery.finalFeeMinor
      : draft.delivery.finalFeeMinor - draft.delivery.finalFeeMinor;
  let pricing: OrderPricing | null = null;
  try {
    pricing = calculateOrderPricing({
      lines: draft.lines,
      discountMinor: draft.discountMinor,
      deliveryFeeMinor,
    });
  } catch (error) {
    issues.push({
      path: 'discount',
      code: 'INVALID_PRICING',
      message: error instanceof DomainInvariantError ? error.message : 'Order pricing is invalid.',
    });
  }

  if (pricing !== null) {
    try {
      preparePaymentParts(draft.payment, configuration.paymentMethods, pricing.totalMinor);
    } catch (error) {
      issues.push({
        path: 'payment',
        code: 'INVALID_PAYMENT',
        message: error instanceof DomainInvariantError ? error.message : 'Payment is invalid.',
      });
    }
  }

  if (issues.length > 0 || orderType === undefined || pricing === null) {
    return { valid: false, issues };
  }
  return { valid: true, value: { orderType, pricing, normalizedDeliveryPhone } };
}
