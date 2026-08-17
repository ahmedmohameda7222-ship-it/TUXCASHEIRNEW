import { describe, expect, it } from 'vitest';
import { DomainInvariantError } from './errors';
import {
  addStockQuantities,
  STOCK_QUANTITY_SCALE,
  stockQuantityMicros,
  wholeStockUnits,
} from './quantity';

describe('StockQuantityMicros', () => {
  it('represents whole bulk units exactly', () => {
    expect(wholeStockUnits(3)).toBe(3 * STOCK_QUANTITY_SCALE);
  });

  it('supports exact fixed-point recipe quantities', () => {
    expect(addStockQuantities(stockQuantityMicros(125_000), stockQuantityMicros(375_000))).toBe(
      500_000,
    );
  });

  it('rejects fractional micro-unit values', () => {
    expect(() => stockQuantityMicros(0.5)).toThrow(DomainInvariantError);
  });
});
