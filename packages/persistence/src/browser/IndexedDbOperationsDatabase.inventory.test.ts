import 'fake-indexeddb/auto';

import {
  instant,
  parseEntityId,
  stockQuantityMicros,
  type BusinessDayId,
  type InventoryItemId,
  type InventoryMovementId,
  type OrderId,
  type ShopId,
  type WorkerId,
} from '@tux/domain';
import { afterEach, describe, expect, it } from 'vitest';

import { IndexedDbOperationsDatabase } from './IndexedDbOperationsDatabase';

const names = new Set<string>();
const SHOP_ID = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const DAY_ID = parseEntityId<BusinessDayId>('22222222-2222-4222-8222-222222222222');
const WORKER_ID = parseEntityId<WorkerId>('33333333-3333-4333-8333-333333333333');
const ITEM_ID = parseEntityId<InventoryItemId>('44444444-4444-4444-8444-444444444444');
const ORDER_ID = parseEntityId<OrderId>('55555555-5555-4555-8555-555555555555');
const AT = instant('2026-09-19T03:00:00.000Z');

function databaseName(): string {
  const name = `inventory-balance-${crypto.randomUUID()}`;
  names.add(name);
  return name;
}

afterEach(async () => {
  for (const name of names) {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  }
  names.clear();
});

describe('IndexedDbOperationsDatabase inventory balance', () => {
  it('projects on-hand, reserved, and available stock from immutable movements', async () => {
    const database = new IndexedDbOperationsDatabase(databaseName());
    await database.initialize();
    try {
      await database.transaction(async (transaction) => {
        await transaction.inventory.appendMovement({
          id: parseEntityId<InventoryMovementId>('66666666-6666-4666-8666-666666666666'),
          shopId: SHOP_ID,
          businessDayId: DAY_ID,
          itemId: ITEM_ID,
          movementType: 'BULK_STOCK_RECEIVED',
          quantityDeltaMicros: stockQuantityMicros(2_000_000),
          idempotencyKey: 'opening-stock',
          workerId: WORKER_ID,
          orderId: null,
          createdAt: AT,
          compensatesMovementId: null,
        });
        await transaction.inventory.appendMovement({
          id: parseEntityId<InventoryMovementId>('77777777-7777-4777-8777-777777777777'),
          shopId: SHOP_ID,
          businessDayId: DAY_ID,
          itemId: ITEM_ID,
          movementType: 'ORDER_RESERVATION',
          quantityDeltaMicros: stockQuantityMicros(0),
          reservedDeltaMicros: stockQuantityMicros(500_000),
          idempotencyKey: 'reservation',
          workerId: WORKER_ID,
          orderId: ORDER_ID,
          createdAt: AT,
          compensatesMovementId: null,
        });

        expect(await transaction.inventory.getBalance(ITEM_ID)).toEqual({
          onHandMicros: 2_000_000,
          reservedMicros: 500_000,
          availableMicros: 1_500_000,
        });
      });
    } finally {
      await database.close();
    }
  });
});
