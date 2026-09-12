import type { OperationsConfigurationSnapshot } from './catalog';
import { DomainInvariantError } from './errors';
import { addMoney, moneyMinor, subtractMoney, ZERO_MONEY, type MoneyMinor } from './money';
import type { DraftOrderLine } from './orderDraft';
import { calculateOrderPricing, type OrderPricing } from './pricing';

export type CheckoutChannel = 'POS' | 'ONLINE';

export interface EffectiveCheckoutPolicy {
  readonly settingsVersion: number | null;
  readonly minimumOrderMinor: MoneyMinor;
  readonly serviceChargeBps: number;
  readonly taxBps: number;
}

export interface CheckoutPricing extends OrderPricing {
  readonly serviceChargeMinor: MoneyMinor;
  readonly taxMinor: MoneyMinor;
}

function nonNegativeIntegerSetting(
  configuration: OperationsConfigurationSnapshot,
  key: 'checkout.minimumOrderMinor' | 'checkout.serviceChargeBps' | 'checkout.taxBps',
  maximum: number,
): number {
  const value = configuration.settings?.values[key];
  if (value === undefined || value === null) return 0;
  if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < 0 || value > maximum) {
    throw new DomainInvariantError(`Published ${key} is invalid.`);
  }
  return value;
}

export function resolveEffectiveCheckoutPolicy(
  configuration: OperationsConfigurationSnapshot,
): EffectiveCheckoutPolicy {
  return {
    settingsVersion: configuration.settings?.version ?? null,
    minimumOrderMinor: moneyMinor(
      nonNegativeIntegerSetting(configuration, 'checkout.minimumOrderMinor', Number.MAX_SAFE_INTEGER),
    ),
    serviceChargeBps: nonNegativeIntegerSetting(
      configuration,
      'checkout.serviceChargeBps',
      10_000,
    ),
    taxBps: nonNegativeIntegerSetting(configuration, 'checkout.taxBps', 10_000),
  };
}

export function applyBasisPoints(baseMinor: MoneyMinor, basisPoints: number): MoneyMinor {
  if (baseMinor < ZERO_MONEY) {
    throw new DomainInvariantError('Checkout charge base cannot be negative.');
  }
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) {
    throw new DomainInvariantError('Checkout basis points must be between 0 and 10000.');
  }
  if (baseMinor === ZERO_MONEY || basisPoints === 0) return ZERO_MONEY;

  const rounded = (BigInt(baseMinor) * BigInt(basisPoints) + 5_000n) / 10_000n;
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new DomainInvariantError('Checkout charge exceeded the safe money range.');
  }
  return moneyMinor(Number(rounded));
}

export function calculateCheckoutPricing(input: {
  readonly lines: readonly DraftOrderLine[];
  readonly discountMinor: MoneyMinor;
  readonly deliveryFeeMinor: MoneyMinor;
  readonly policy: EffectiveCheckoutPolicy;
}): CheckoutPricing {
  const base = calculateOrderPricing({
    lines: input.lines,
    discountMinor: input.discountMinor,
    deliveryFeeMinor: input.deliveryFeeMinor,
  });
  const netItemsMinor = subtractMoney(base.itemsSubtotalMinor, base.discountMinor);
  const serviceChargeMinor = applyBasisPoints(netItemsMinor, input.policy.serviceChargeBps);
  const preTaxMinor = addMoney(netItemsMinor, serviceChargeMinor, base.deliveryFeeMinor);
  const taxMinor = applyBasisPoints(preTaxMinor, input.policy.taxBps);

  return {
    ...base,
    serviceChargeMinor,
    taxMinor,
    totalMinor: addMoney(preTaxMinor, taxMinor),
  };
}
