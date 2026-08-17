import { brandValue, type Brand } from './brand';
import { DomainInvariantError } from './errors';

export type MoneyMinor = Brand<number, 'MoneyMinor'>;

export function moneyMinor(value: number): MoneyMinor {
  if (!Number.isSafeInteger(value)) {
    throw new DomainInvariantError(`Money minor units must be a safe integer, received ${value}.`);
  }
  return brandValue<number, 'MoneyMinor'>(value);
}

export const ZERO_MONEY = moneyMinor(0);

export function addMoney(...values: readonly MoneyMinor[]): MoneyMinor {
  return values.reduce<MoneyMinor>((total, value) => moneyMinor(total + value), ZERO_MONEY);
}

export function subtractMoney(left: MoneyMinor, right: MoneyMinor): MoneyMinor {
  return moneyMinor(left - right);
}

export function assertNonNegativeMoney(value: MoneyMinor, label: string): void {
  if (value < 0) {
    throw new DomainInvariantError(`${label} cannot be negative.`);
  }
}
