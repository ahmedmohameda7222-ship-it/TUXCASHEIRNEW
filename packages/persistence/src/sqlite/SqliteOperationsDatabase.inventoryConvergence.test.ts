import { describe, expect, it } from 'vitest';
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

import { SqliteOperationsDatabase } from './SqliteOperationsDatabase';

const SHOP_ID = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const ITEM_ID = parseEntityId<InventoryItemId>('22222222-2222-4222-8222-222222222222');
const REMOTE_DAY_ID = parseEntityId<BusinessDayId>('33333333-3333-4333-8333-333333333333');
const REMOTE_WORKER_ID = parseEntityId<WorkerId>('44444444-4444-4444-8444-444444444444');
const REMOTE_ORDER_ID = parseEntityId<OrderId>('55555555-5555-4555-8555-555555555555');

describe('SqliteOperationsDatabase canonical inventory convergence', () => {
  it('stores remote movements even when their order, day, and worker are not local', async () => {
    const database = new SqliteOperationsDatabase(':memory:');
    await database.initialize();
    try {
      await database.transaction(async (transaction) => {
        await transaction.shops.put({ id: SHOP_ID, name: 'Convergence Shop', active: true });
        await transaction.inventory.putItem({
          id: ITEM_ID,
          shopId: SHOP_ID,
          name: 'Flour',
          unitLabel: 'kg',
          trackingMode: 'RECIPE_TRACKED',
          active: true,
        });
        await transaction.inventory.upsertCanonicalMovement({
          id: parseEntityId<InventoryMovementId>('66666666-6666-4666-8666-666666666666'),
          shopId: SHOP_ID,
          businessDayId: null,
          itemId: ITEM_ID,
          movementType: 'BULK_STOCK_RECEIVED',
          quantityDeltaMicros: stockQuantityMicros(1_000_000),
          reservedDeltaMicros: stockQuantityMicros(0),
          idempotencyKey: 'canonical-opening-stock',
          workerId: null,
          orderId: null,
          createdAt: instant('2026-09-19T03:00:00.000Z'),
          compensatesMovementId: null,
        });
      });

      await expect(
        database.transaction((transaction) =>
          transaction.inventory.upsertCanonicalMovement({
            id: parseEntityId<InventoryMovementId>('77777777-7777-4777-8777-777777777777'),
            shopId: SHOP_ID,
            businessDayId: REMOTE_DAY_ID,
            itemId: ITEM_ID,
            movementType: 'ORDER_RESERVATION',
            quantityDeltaMicros: stockQuantityMicros(0),
            reservedDeltaMicros: stockQuantityMicros(500_000),
            idempotencyKey: 'remote-device-reservation',
            workerId: REMOTE_WORKER_ID,
            orderId: REMOTE_ORDER_ID,
            createdAt: instant('2026-09-19T03:01:00.000Z'),
            compensatesMovementId: null,
          }),
        ),
      ).resolves.toBeUndefined();

      await expect(
        database.transaction((transaction) => transaction.inventory.getBalance(ITEM_ID)),
      ).resolves.toEqual({
        onHandMicros: 1_000_000,
        reservedMicros: 500_000,
        availableMicros: 500_000,
      });
    } finally {
      database.close();
    }
  });
});
