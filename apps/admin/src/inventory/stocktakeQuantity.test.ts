import { describe, expect, it } from 'vitest';

import { parseStocktakeMicros } from './stocktakeQuantity';

describe('physical stock count precision', () => {
  it('accepts an explicit zero and exact six-decimal base quantities', () => {
    expect(parseStocktakeMicros('0')).toBe(0);
    expect(parseStocktakeMicros('0.000001')).toBe(1);
    expect(parseStocktakeMicros('123.123456')).toBe(123_123_456);
  });

  it('rejects values that would silently round or overflow the real ledger', () => {
    for (const value of ['-0.1', '1.0000009', '0.0000001', '1e2', 'NaN', 'Infinity', '', ' ']) {
      expect(parseStocktakeMicros(value)).toBeNull();
    }
    expect(parseStocktakeMicros('999999999999999999')).toBeNull();
  });
});
