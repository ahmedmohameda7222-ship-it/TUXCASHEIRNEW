import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  instant,
  moneyMinor,
  parseEntityId,
  stockQuantityMicros,
  type BusinessDayId,
  type DraftLineId,
  type InventoryItemId,
  type InventoryMovementId,
  type MenuCategoryId,
  type OperationsConfigurationSnapshot,
  type OrderDraft,
  type OrderTypeId,
  type PaymentMethodId,
  type ProductId,
  type ShopId,
  type WorkerId,
  type WorkerSessionId,
} from '@tux/domain';
import {
  SqliteOperationsDatabase,
  SqliteOperatorSessionReadModel,
  SqliteOrderDraftStore,
} from '@tux/persistence/sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { ApplicationCommandCoordinator } from './commandCoordinator';
import { OperationsOrdersService } from './orders';
import { OperationsOrdersBoardService } from './ordersBoard';

const SHOP_ID = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const WORKER_ID = parseEntityId<WorkerId>('22222222-2222-4222-8222-222222222222');
const DAY_ID = parseEntityId<BusinessDayId>('33333333-3333-4333-8333-333333333333');
const CATEGORY_ID = parseEntityId<MenuCategoryId>('44444444-4444-4444-8444-444444444444');
const PRODUCT_ID = parseEntityId<ProductId>('55555555-5555-4555-8555-555555555555');
const INVENTORY_ITEM_ID = parseEntityId<InventoryItemId>(
  '66666666-6666-4666-8666-666666666666',
);
const ORDER_TYPE_ID = parseEntityId<OrderTypeId>('77777777-7777-4777-8777-777777777777');
const PAYMENT_ID = parseEntityId<PaymentMethodId>('88888888-8888-4888-8888-888888888888');
const AT = instant('2026-09-19T02:00:00.000Z');
const temporaryDirectories: string[] = [];

const CONFIGURATION: OperationsConfigurationSnapshot = {
  shopId: SHOP_ID,
  version: 1,
  updatedAt: AT,
  categories: [{ id: CATEGORY_ID, shopId: SHOP_ID, name: 'Food', sortOrder: 0, active: true }],
  products: [
    {
      id: PRODUCT_ID,
      shopId: SHOP_ID,
      categoryId: CATEGORY_ID,
      name: 'Inventory Burger',
      description: null,
      priceMinor: moneyMinor(10_000),
      imageKey: null,
      active: true,
      soldOut: false,
      isCombo: false,
      sortOrder: 0,
    },
  ],
  modifiers: [],
  productModifierLinks: [],
  comboBeverageOptions: [],
  recipeLines: [
    {
      shopId: SHOP_ID,
      productId: PRODUCT_ID,
      inventoryItemId: INVENTORY_ITEM_ID,
      quantityMicros: stockQuantityMicros(500_000),
    },
  ],
  orderTypes: [
    {
      id: ORDER_TYPE_ID,
      shopId: SHOP_ID,
      name: 'Take Away',
      behavior: 'TAKE_AWAY',
      active: true,
      sortOrder: 0,
    },
  ],
  paymentMethods: [
    {
      id: PAYMENT_ID,
      shopId: SHOP_ID,
      displayName: 'Cash',
      logicType: 'CASH',
      requiresReconciliation: true,
      active: true,
      sortOrder: 0,
    },
  ],
  deliveryZones: [],
};

function draft(intentKey: string): OrderDraft {
  return {
    shopId: SHOP_ID,
    businessDayId: DAY_ID,
    draftScopeId: 'inventory-lifecycle',
    revision: 0,
    updatedAt: AT,
    checkoutIntentKey: intentKey,
    orderTypeId: ORDER_TYPE_ID,
    lines: [
      {
        id: parseEntityId<DraftLineId>('99999999-9999-4999-8999-999999999999'),
        productId: PRODUCT_ID,
        productName: 'Inventory Burger',
        unitPriceMinor: moneyMinor(10_000),
        quantity: 1,
        modifiers: [],
        comboBeverages: [],
        itemNote: null,
        addedSequence: 1,
      },
    ],
    orderNote: null,
    discountMinor: moneyMinor(0),
    delivery: {
      displayPhone: '',
      normalizedPhone: '',
      customerName: '',
      address: '',
      zoneId: null,
      zoneLabel: '',
      configuredFeeMinor: moneyMinor(0),
      finalFeeMinor: moneyMinor(0),
    },
    payment: {
      mode: 'SINGLE',
      methodId: PAYMENT_ID,
      cashReceivedMinor: moneyMinor(10_000),
    },
  };
}

async function fixture(initialStockMicros = 5_000_000) {
  const directory = await mkdtemp(join(tmpdir(), 'tux-order-inventory-lifecycle-'));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, 'operations.sqlite3');
  const database = new SqliteOperationsDatabase(databasePath);
  await database.initialize();

  await database.transaction(async (transaction) => {
    await transaction.shops.put({ id: SHOP_ID, name: 'TUX', active: true });
    await transaction.workers.put({
      id: WORKER_ID,
      shopId: SHOP_ID,
      displayName: 'Worker',
      pinHash: 'test-only',
      active: true,
    });
    await transaction.businessDays.put({
      id: DAY_ID,
      shopId: SHOP_ID,
      status: 'OPEN',
      startedAt: AT,
      endedAt: null,
      startedByWorkerId: WORKER_ID,
      endedByWorkerId: null,
      lastAllocatedDisplayOrderNo: 0,
    });
    await transaction.workerSessions.put({
      id: parseEntityId<WorkerSessionId>('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
      shopId: SHOP_ID,
      businessDayId: DAY_ID,
      workerId: WORKER_ID,
      startedAt: AT,
      endedAt: null,
    });
    await transaction.configuration.put(CONFIGURATION);
    await transaction.inventory.putItem({
      id: INVENTORY_ITEM_ID,
      shopId: SHOP_ID,
      name: 'Beef',
      unitLabel: 'g',
      trackingMode: 'RECIPE_TRACKED',
      active: true,
    });
    await transaction.inventory.appendMovement({
      id: parseEntityId<InventoryMovementId>('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
      shopId: SHOP_ID,
      businessDayId: DAY_ID,
      itemId: INVENTORY_ITEM_ID,
      movementType: 'BULK_STOCK_RECEIVED',
      quantityDeltaMicros: stockQuantityMicros(initialStockMicros),
      idempotencyKey: 'seed-stock',
      workerId: WORKER_ID,
      orderId: null,
      createdAt: AT,
      compensatesMovementId: null,
    });
  });

  const readModel = new SqliteOperatorSessionReadModel(databasePath);
  const draftStore = new SqliteOrderDraftStore(databasePath);
  await draftStore.initialize();
  let sequence = 0;
  const runtime = {
    now: () => instant('2026-09-19T02:01:00.000Z'),
    createUuid: () => `cccccccc-cccc-4ccc-8ccc-${String(++sequence).padStart(12, '0')}`,
  };
  const coordinator = new ApplicationCommandCoordinator();
  const orders = new OperationsOrdersService(
    database,
    readModel,
    draftStore,
    runtime,
    coordinator,
    { print: async () => ({ ok: true as const }) },
  );
  const board = new OperationsOrdersBoardService(database, readModel, runtime, coordinator);

  return { database, readModel, draftStore, orders, board };
}

async function closeFixture(test: Awaited<ReturnType<typeof fixture>>) {
  await test.readModel.close();
  await test.draftStore.close();
  await test.database.close();
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('Operations order inventory lifecycle', () => {
  it('reserves on ACTIVE, consumes on DONE, and restores reservation on undo DONE', async () => {
    const test = await fixture();
    try {
      const placed = await test.orders.placeOrder(
        draft('dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
      );
      expect(placed.ok).toBe(true);
      if (!placed.ok) return;

      let orderMovements = await test.database.transaction((transaction) =>
        transaction.inventory.listMovementsForOrder(placed.value.order.id),
      );
      expect(orderMovements).toHaveLength(1);
      expect(orderMovements[0]).toMatchObject({
        movementType: 'ORDER_RESERVATION',
        quantityDeltaMicros: 0,
        reservedDeltaMicros: 500_000,
      });

      const done = await test.board.markDone(placed.value.order.id);
      expect(done.ok).toBe(true);
      orderMovements = await test.database.transaction((transaction) =>
        transaction.inventory.listMovementsForOrder(placed.value.order.id),
      );
      expect(orderMovements.map((movement) => movement.movementType)).toEqual([
        'ORDER_RESERVATION',
        'ORDER_CONSUMPTION',
      ]);
      expect(orderMovements[1]).toMatchObject({
        quantityDeltaMicros: -500_000,
        reservedDeltaMicros: -500_000,
      });

      const undone = await test.board.undoDone(placed.value.order.id);
      expect(undone.ok).toBe(true);
      orderMovements = await test.database.transaction((transaction) =>
        transaction.inventory.listMovementsForOrder(placed.value.order.id),
      );
      expect(orderMovements.map((movement) => movement.movementType)).toEqual([
        'ORDER_RESERVATION',
        'ORDER_CONSUMPTION',
        'ORDER_CONSUMPTION_REVERSAL',
      ]);
      expect(orderMovements[2]).toMatchObject({
        quantityDeltaMicros: 500_000,
        reservedDeltaMicros: 500_000,
      });
    } finally {
      await closeFixture(test);
    }
  });

  it('blocks placement when initialized available stock is below the recipe requirement', async () => {
    const test = await fixture(250_000);
    try {
      const placed = await test.orders.placeOrder(
        draft('abababab-abab-4bab-8bab-abababababab'),
      );
      expect(placed.ok).toBe(false);
      if (placed.ok) return;
      expect(placed.error.code).toBe('CONFLICT_ERROR');
      expect(placed.error.message).toMatch(/insufficient available stock/i);

      const balance = await test.database.transaction((transaction) =>
        transaction.inventory.getBalance(INVENTORY_ITEM_ID),
      );
      expect(balance).toMatchObject({
        initialized: true,
        onHandMicros: 250_000,
        reservedMicros: 0,
        availableMicros: 250_000,
      });
    } finally {
      await closeFixture(test);
    }
  });

  it('releases an ACTIVE reservation on cancellation even when foodPrepared is true', async () => {
    const test = await fixture();
    try {
      const placed = await test.orders.placeOrder(
        draft('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
      );
      expect(placed.ok).toBe(true);
      if (!placed.ok) return;

      const cancelled = await test.board.cancelOrder({
        orderId: placed.value.order.id,
        foodPrepared: true,
        reason: 'Customer changed mind',
      });
      expect(cancelled.ok).toBe(true);

      const orderMovements = await test.database.transaction((transaction) =>
        transaction.inventory.listMovementsForOrder(placed.value.order.id),
      );
      expect(orderMovements.map((movement) => movement.movementType)).toEqual([
        'ORDER_RESERVATION',
        'ORDER_RESERVATION_RELEASE',
      ]);
      expect(orderMovements[1]).toMatchObject({
        quantityDeltaMicros: 0,
        reservedDeltaMicros: -500_000,
      });
    } finally {
      await closeFixture(test);
    }
  });
});
