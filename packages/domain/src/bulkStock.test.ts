import { describe, expect, it } from 'vitest';
import {
  BULK_STOCK_UNDO_WINDOW_MS,
  bulkStockBalance,
  bulkStockWholeUnitCount,
  canUndoBulkMovement,
  finishedBulkUnitDelta,
  receivedBulkStockDelta,
  undoBulkMovementDelta,
  undoBulkMovementType,
} from './bulkStock';
import { parseEntityId } from './ids';
import type { BusinessDayId, InventoryItemId, InventoryMovementId, ShopId, WorkerId } from './ids';
import type { InventoryMovement } from './models';
import { wholeStockUnits } from './quantity';
import { instant } from './time';

const SHOP_ID = parseEntityId<ShopId>('11000000-0000-4000-8000-000000000001');
const DAY_ID = parseEntityId<BusinessDayId>('21000000-0000-4000-8000-000000000001');
const ITEM_ID = parseEntityId<InventoryItemId>('31000000-0000-4000-8000-000000000001');
const WORKER_ID = parseEntityId<WorkerId>('41000000-0000-4000-8000-000000000001');

function movement(
  id: string,
  movementType: InventoryMovement['movementType'],
  delta: number,
  createdAt = '2026-08-18T10:00:00.000Z',
): InventoryMovement {
  return {
    id: parseEntityId<InventoryMovementId>(id),
    shopId: SHOP_ID,
    businessDayId: DAY_ID,
    itemId: ITEM_ID,
    movementType,
    quantityDeltaMicros: wholeStockUnits(delta),
    idempotencyKey: `fixture:${id}`,
    workerId: WORKER_ID,
    orderId: null,
    createdAt: instant(createdAt),
    compensatesMovementId: null,
  };
}

describe('Bulk Stock domain rules', () => {
  it('derives current whole-unit balance from append-only worker movements', () => {
    const balance = bulkStockBalance([
      movement('51000000-0000-4000-8000-000000000001', 'BULK_STOCK_RECEIVED', 5),
      movement('51000000-0000-4000-8000-000000000002', 'BULK_UNIT_FINISHED', -1),
      movement('51000000-0000-4000-8000-000000000003', 'BULK_UNIT_FINISHED', -1),
      movement('51000000-0000-4000-8000-000000000004', 'UNDO_BULK_UNIT_FINISHED', 1),
    ]);
    expect(bulkStockWholeUnitCount(balance)).toBe(4);
  });

  it('uses exact whole-unit deltas', () => {
    expect(finishedBulkUnitDelta()).toBe(wholeStockUnits(-1));
    expect(receivedBulkStockDelta(5)).toBe(wholeStockUnits(5));
    expect(() => receivedBulkStockDelta(0)).toThrow(/positive whole number/);
    expect(() => receivedBulkStockDelta(1.5)).toThrow(/positive whole number/);
  });

  it('creates the exact opposite compensation for a recent worker movement', () => {
    const finished = movement('51000000-0000-4000-8000-000000000005', 'BULK_UNIT_FINISHED', -1);
    const received = movement('51000000-0000-4000-8000-000000000006', 'BULK_STOCK_RECEIVED', 5);
    expect(undoBulkMovementDelta(finished)).toBe(wholeStockUnits(1));
    expect(undoBulkMovementType(finished)).toBe('UNDO_BULK_UNIT_FINISHED');
    expect(undoBulkMovementDelta(received)).toBe(wholeStockUnits(-5));
    expect(undoBulkMovementType(received)).toBe('UNDO_BULK_STOCK_RECEIVED');
  });

  it('allows Undo only inside the short window and only once', () => {
    const original = movement('51000000-0000-4000-8000-000000000007', 'BULK_STOCK_RECEIVED', 3);
    expect(
      canUndoBulkMovement(
        original,
        instant(`2026-08-18T10:00:0${BULK_STOCK_UNDO_WINDOW_MS / 1000}.000Z`),
        false,
      ),
    ).toBe(true);
    expect(canUndoBulkMovement(original, instant('2026-08-18T10:00:08.001Z'), false)).toBe(false);
    expect(canUndoBulkMovement(original, instant('2026-08-18T10:00:01.000Z'), true)).toBe(false);
  });
});
