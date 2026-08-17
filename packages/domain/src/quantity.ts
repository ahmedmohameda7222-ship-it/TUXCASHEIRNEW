import { brandValue, type Brand } from './brand';
import { DomainInvariantError } from './errors';

export const STOCK_QUANTITY_SCALE = 1_000_000;

export type StockQuantityMicros = Brand<number, 'StockQuantityMicros'>;

export function stockQuantityMicros(value: number): StockQuantityMicros {
  if (!Number.isSafeInteger(value)) {
    throw new DomainInvariantError(
      `Stock quantity micro-units must be a safe integer, received ${value}.`,
    );
  }

  return brandValue<number, 'StockQuantityMicros'>(value);
}

export function wholeStockUnits(units: number): StockQuantityMicros {
  if (!Number.isSafeInteger(units)) {
    throw new DomainInvariantError(`Whole stock units must be a safe integer, received ${units}.`);
  }

  return stockQuantityMicros(units * STOCK_QUANTITY_SCALE);
}

export function addStockQuantities(...values: readonly StockQuantityMicros[]): StockQuantityMicros {
  return values.reduce<StockQuantityMicros>(
    (total, value) => stockQuantityMicros(total + value),
    stockQuantityMicros(0),
  );
}
