import { DomainInvariantError } from './errors';
import {
  addMoney,
  assertNonNegativeMoney,
  multiplyMoney,
  subtractMoney,
  type MoneyMinor,
} from './money';
import type { DraftOrderLine } from './orderDraft';

export interface OrderPricing {
  readonly itemsSubtotalMinor: MoneyMinor;
  readonly discountMinor: MoneyMinor;
  readonly deliveryFeeMinor: MoneyMinor;
  readonly totalMinor: MoneyMinor;
}

export function calculateDraftLineTotal(line: DraftOrderLine): MoneyMinor {
  if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
    throw new DomainInvariantError('Draft line quantity must be a positive safe integer.');
  }

  const modifierUnitTotal = addMoney(
    ...line.modifiers.map((modifier) => {
      if (!Number.isSafeInteger(modifier.quantity) || modifier.quantity <= 0) {
        throw new DomainInvariantError('Modifier quantity must be a positive safe integer.');
      }
      return multiplyMoney(modifier.unitPriceMinor, modifier.quantity);
    }),
  );
  const configuredUnitTotal = addMoney(line.unitPriceMinor, modifierUnitTotal);
  return multiplyMoney(configuredUnitTotal, line.quantity);
}

export function calculateOrderPricing(input: {
  readonly lines: readonly DraftOrderLine[];
  readonly discountMinor: MoneyMinor;
  readonly deliveryFeeMinor: MoneyMinor;
}): OrderPricing {
  assertNonNegativeMoney(input.discountMinor, 'Discount');
  assertNonNegativeMoney(input.deliveryFeeMinor, 'Delivery fee');

  const itemsSubtotalMinor = addMoney(...input.lines.map(calculateDraftLineTotal));
  if (input.discountMinor > itemsSubtotalMinor) {
    throw new DomainInvariantError('Discount cannot exceed items subtotal.');
  }
  const totalMinor = addMoney(
    subtractMoney(itemsSubtotalMinor, input.discountMinor),
    input.deliveryFeeMinor,
  );
  return {
    itemsSubtotalMinor,
    discountMinor: input.discountMinor,
    deliveryFeeMinor: input.deliveryFeeMinor,
    totalMinor,
  };
}
