import { describe, expect, it } from 'vitest';
import { DomainInvariantError } from './errors';
import { addMoney, moneyMinor, subtractMoney } from './money';

describe('MoneyMinor', () => {
  it('performs exact integer arithmetic', () => {
    expect(addMoney(moneyMinor(10_005), moneyMinor(2_995))).toBe(13_000);
    expect(subtractMoney(moneyMinor(20_000), moneyMinor(7_001))).toBe(12_999);
  });

  it('rejects fractional and unsafe values', () => {
    expect(() => moneyMinor(1.5)).toThrow(DomainInvariantError);
    expect(() => moneyMinor(Number.MAX_SAFE_INTEGER + 1)).toThrow(DomainInvariantError);
  });
});
