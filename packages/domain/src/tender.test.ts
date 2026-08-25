import { describe, expect, it } from 'vitest';
import { DomainInvariantError } from './errors';
import { moneyMinor } from './money';
import { suggestCashTenders } from './tender';

describe('suggestCashTenders', () => {
  it.each([
    [70_500, [70_500, 71_000, 72_000, 75_000, 80_000]],
    [71_500, [71_500, 72_000, 75_000, 80_000]],
    [76_300, [76_300, 77_000, 78_000, 80_000]],
  ])('returns exact plus practical rounded tenders for %s minor units', (total, expected) => {
    expect(suggestCashTenders(moneyMinor(total)).map((item) => item.totalMinor)).toEqual(
      expected.map(moneyMinor),
    );
  });

  it('removes duplicate rounded totals while preserving exact total first', () => {
    expect(
      suggestCashTenders(moneyMinor(70_000), [
        moneyMinor(1_000),
        moneyMinor(2_000),
        moneyMinor(5_000),
      ]).map((item) => item.totalMinor),
    ).toEqual([moneyMinor(70_000)]);
  });

  it('returns no suggestions for non-positive totals', () => {
    expect(suggestCashTenders(moneyMinor(0))).toEqual([]);
    expect(suggestCashTenders(moneyMinor(-100))).toEqual([]);
  });

  it('rejects an empty custom rounding-step set', () => {
    expect(() => suggestCashTenders(moneyMinor(70_500), [])).toThrow(DomainInvariantError);
  });

  it.each([moneyMinor(0), moneyMinor(-1)])('rejects invalid custom rounding step %s', (step) => {
    expect(() => suggestCashTenders(moneyMinor(70_500), [step])).toThrow(DomainInvariantError);
  });

  it('rejects rounded values that exceed the safe-integer range', () => {
    expect(() =>
      suggestCashTenders(moneyMinor(Number.MAX_SAFE_INTEGER), [
        moneyMinor(Number.MAX_SAFE_INTEGER - 1),
      ]),
    ).toThrow('Tender suggestion exceeded safe integer range.');
  });
});
