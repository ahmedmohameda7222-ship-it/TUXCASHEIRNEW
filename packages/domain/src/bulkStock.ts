import { DomainInvariantError } from './errors';
import type { Instant } from './time';
import type { InventoryMovement, InventoryMovementType } from './models';
import {
  STOCK_QUANTITY_SCALE,
  addStockQuantities,
  stockQuantityMicros,
  wholeStockUnits,
  type StockQuantityMicros,
} from './quantity';

export const BULK_STOCK_UNDO_WINDOW_MS = 8_000;

export type BulkStockMovementType =
  | 'BULK_UNIT_FINISHED'
  | 'BULK_STOCK_RECEIVED'
  | 'UNDO_BULK_UNIT_FINISHED'
  | 'UNDO_BULK_STOCK_RECEIVED'
  | 'ADMIN_ADJUSTMENT';

export function isBulkStockMovementType(
  value: InventoryMovementType,
): value is BulkStockMovementType {
  return (
    value === 'BULK_UNIT_FINISHED' ||
    value === 'BULK_STOCK_RECEIVED' ||
    value === 'UNDO_BULK_UNIT_FINISHED' ||
    value === 'UNDO_BULK_STOCK_RECEIVED' ||
    value === 'ADMIN_ADJUSTMENT'
  );
}

export function bulkStockBalance(
  movements: readonly InventoryMovement[],
): StockQuantityMicros {
  return addStockQuantities(
    ...movements
      .filter((movement) => isBulkStockMovementType(movement.movementType))
      .map((movement) => movement.quantityDeltaMicros),
  );
}

export function bulkStockWholeUnitCount(balance: StockQuantityMicros): number {
  if (balance % STOCK_QUANTITY_SCALE !== 0) {
    throw new DomainInvariantError('Bulk Stock balance must be a whole-unit quantity.');
  }
  return balance / STOCK_QUANTITY_SCALE;
}

export function finishedBulkUnitDelta(): StockQuantityMicros {
  return wholeStockUnits(-1);
}

export function receivedBulkStockDelta(units: number): StockQuantityMicros {
  if (!Number.isSafeInteger(units) || units <= 0) {
    throw new DomainInvariantError('Add Stock quantity must be a positive whole number.');
  }
  return wholeStockUnits(units);
}

export function undoBulkMovementDelta(original: InventoryMovement): StockQuantityMicros {
  if (
    original.movementType !== 'BULK_UNIT_FINISHED' &&
    original.movementType !== 'BULK_STOCK_RECEIVED'
  ) {
    throw new DomainInvariantError('Only a newly recorded Bulk Stock worker movement can be undone.');
  }
  return stockQuantityMicros(-original.quantityDeltaMicros);
}

export function undoBulkMovementType(
  original: InventoryMovement,
): 'UNDO_BULK_UNIT_FINISHED' | 'UNDO_BULK_STOCK_RECEIVED' {
  if (original.movementType === 'BULK_UNIT_FINISHED') return 'UNDO_BULK_UNIT_FINISHED';
  if (original.movementType === 'BULK_STOCK_RECEIVED') return 'UNDO_BULK_STOCK_RECEIVED';
  throw new DomainInvariantError('Only a newly recorded Bulk Stock worker movement can be undone.');
}

export function canUndoBulkMovement(
  original: InventoryMovement,
  now: Instant,
  alreadyCompensated: boolean,
): boolean {
  if (alreadyCompensated) return false;
  if (
    original.movementType !== 'BULK_UNIT_FINISHED' &&
    original.movementType !== 'BULK_STOCK_RECEIVED'
  ) {
    return false;
  }
  const originalTime = Date.parse(original.createdAt);
  const nowTime = Date.parse(now);
  if (!Number.isFinite(originalTime) || !Number.isFinite(nowTime) || nowTime < originalTime) {
    return false;
  }
  return nowTime - originalTime <= BULK_STOCK_UNDO_WINDOW_MS;
}
