import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  instant,
  moneyMinor,
  parseEntityId,
  stockQuantityMicros,
  type BusinessDayId,
  type DeliveryZoneId,
  type InventoryItemId,
  type MenuCategoryId,
  type OperationsConfigurationSnapshot,
  type OrderId,
  type OrderTypeId,
  type PaymentMethodId,
  type ProductId,
  type ShopId,
  type WorkerId,
  type WorkerSessionId,
} from '@tux/domain';
import type { OperationsDatabase } from '@tux/persistence';
import type { CachedOnlineOrderRequest } from '@tux/persistence';
import {
  SqliteOperationsDatabase,
  SqliteOperatorSessionReadModel,
  SqliteOrderDraftStore,
} from '@tux/persistence/sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { ApplicationCommandCoordinator } from './commandCoordinator';
import { OperationsOnlineOrderAcceptanceService } from './onlineOrderAcceptance';
import { OperationsOrdersService } from './orders';

const SHOP_ID = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const WORKER_ID = parseEntityId<WorkerId>('22222222-2222-4222-8222-222222222222');
const DAY_ID = parseEntityId<BusinessDayId>('33333333-3333-4333-8333-333333333333');
const CATEGORY_ID = parseEntityId<MenuCategoryId>('44444444-4444-4444-8444-444444444444');
const PRODUCT_ID = parseEntityId<ProductId>('55555555-5555-4555-8555-555555555555');
const INVENTORY_ID = parseEntityId<InventoryItemId>('55555555-5555-4555-8555-555555555556');
const TAKE_AWAY_ID = parseEntityId<OrderTypeId>('66666666-6666-4666-8666-666666666666');
const DELIVERY_ID = parseEntityId<OrderTypeId>('66666666-6666-4666-8666-666666666667');
const ZONE_ID = parseEntityId<DeliveryZoneId>('77777777-7777-4777-8777-777777777777');
const CASH_ID = parseEntityId<PaymentMethodId>('88888888-8888-4888-8888-888888888888');
const SESSION_ID = parseEntityId<WorkerSessionId>('99999999-9999-4999-8999-999999999999');
const REQUEST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROCESSING_ORDER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RESERVED_ORDER_ID = parseEntityId<OrderId>(PROCESSING_ORDER_ID);
const AT = instant('2026-09-08T16:00:00.000Z');
const temporaryDirectories: string[] = [];

const CONFIGURATION: OperationsConfigurationSnapshot = {
  shopId: SHOP_ID,
  version: 17,
  updatedAt: AT,
  categories: [{ id: CATEGORY_ID, shopId: SHOP_ID, name: 'Burgers', sortOrder: 0, active: true }],
  products: [
    {
      id: PRODUCT_ID,
      shopId: SHOP_ID,
      categoryId: CATEGORY_ID,
      name: 'Online Burger',
      description: null,
      priceMinor: moneyMinor(19_000),
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
      inventoryItemId: INVENTORY_ID,
      quantityMicros: stockQuantityMicros(1_000_000),
    },
  ],
  orderTypes: [
    {
      id: TAKE_AWAY_ID,
      shopId: SHOP_ID,
      name: 'Take Away',
      behavior: 'TAKE_AWAY',
      active: true,
      sortOrder: 0,
    },
    {
      id: DELIVERY_ID,
      shopId: SHOP_ID,
      name: 'Delivery',
      behavior: 'DELIVERY',
      active: true,
      sortOrder: 1,
    },
  ],
  paymentMethods: [
    {
      id: CASH_ID,
      shopId: SHOP_ID,
      displayName: 'Cash',
      logicType: 'CASH',
      requiresReconciliation: true,
      active: true,
      sortOrder: 0,
    },
  ],
  deliveryZones: [
    {
      id: ZONE_ID,
      shopId: SHOP_ID,
      name: 'Nasr City',
      feeMinor: moneyMinor(3_000),
      active: true,
      sortOrder: 0,
    },
  ],
};

function onlineRequest(
  fulfillmentPreference: 'PICKUP' | 'DELIVERY' = 'PICKUP',
): CachedOnlineOrderRequest {
  return {
    requestId: REQUEST_ID,
    shopId: SHOP_ID,
    status: 'PROCESSING',
    catalogRevision: 'a'.repeat(64),
    fulfillmentPreference,
    paymentPreference: 'CASH',
    customerName: 'Online Customer',
    normalizedPhone: fulfillmentPreference === 'DELIVERY' ? '01012345678' : null,
    deliveryAddress: fulfillmentPreference === 'DELIVERY' ? 'Nasr City, Cairo' : null,
    trustedItems: [
      {
        productId: PRODUCT_ID,
        productName: 'Online Burger',
        unitPriceMinor: 19_000,
        quantity: 1,
        modifiers: [],
        comboBeverage: null,
        note: null,
      },
    ],
    itemsSubtotalMinor: 19_000,
    orderNote: null,
    createdAt: AT,
    processingOrderId: PROCESSING_ORDER_ID,
    processingStartedAt: AT,
    processingExpiresAt: instant('2026-09-08T22:00:00.000Z'),
  };
}

function pickupConfirmation() {
  return {
    orderTypeId: TAKE_AWAY_ID,
    deliveryZoneId: null,
    finalDeliveryFeeMinor: null,
    payment: {
      mode: 'SINGLE' as const,
      methodId: CASH_ID,
      cashReceivedMinor: moneyMinor(20_000),
    },
  };
}

function deliveryConfirmation() {
  return {
    orderTypeId: DELIVERY_ID,
    deliveryZoneId: ZONE_ID,
    finalDeliveryFeeMinor: moneyMinor(2_500),
    payment: {
      mode: 'SINGLE' as const,
      methodId: CASH_ID,
      cashReceivedMinor: moneyMinor(25_000),
    },
  };
}

async function fixture(options: { failingAudit?: boolean; openWorker?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'tux-online-acceptance-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'operations.sqlite3');
  const database = new SqliteOperationsDatabase(path);
  await database.initialize();
  await database.transaction(async (transaction) => {
    await transaction.shops.put({ id: SHOP_ID, name: 'TUX', active: true });
    await transaction.workers.put({
      id: WORKER_ID,
      shopId: SHOP_ID,
      displayName: 'Current Worker',
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
    if (options.openWorker !== false) {
      await transaction.workerSessions.put({
        id: SESSION_ID,
        shopId: SHOP_ID,
        businessDayId: DAY_ID,
        workerId: WORKER_ID,
        startedAt: AT,
        endedAt: null,
      });
    }
    await transaction.configuration.put(CONFIGURATION);
    await transaction.inventory.putItem({
      id: INVENTORY_ID,
      shopId: SHOP_ID,
      name: 'Patty',
      unitLabel: 'unit',
      trackingMode: 'RECIPE_TRACKED',
      active: true,
    });
  });

  const readModel = new SqliteOperatorSessionReadModel(path);
  const draftStore = new SqliteOrderDraftStore(path);
  await draftStore.initialize();
  let sequence = 0;
  const runtime = {
    now: () => AT,
    createUuid: () => `cccccccc-cccc-4ccc-8ccc-${String(++sequence).padStart(12, '0')}`,
  };
  const effectiveDatabase: OperationsDatabase = options.failingAudit
    ? {
        transaction: (work) =>
          database.transaction((transaction) =>
            work({
              ...transaction,
              audit: {
                append: async () => {
                  throw new Error('forced audit failure');
                },
              },
            }),
          ),
      }
    : database;
  const orders = new OperationsOrdersService(
    effectiveDatabase,
    readModel,
    draftStore,
    runtime,
    new ApplicationCommandCoordinator(),
    { print: async () => ({ ok: true as const }) },
  );
  const acceptance = new OperationsOnlineOrderAcceptanceService(orders, runtime);

  return { path, database, readModel, draftStore, acceptance };
}

async function closeFixture(test: Awaited<ReturnType<typeof fixture>>): Promise<void> {
  await test.readModel.close();
  await test.draftStore.close();
  await test.database.close();
}

function rawCounts(path: string): { orders: number; audit: number; outbox: number } {
  const raw = new DatabaseSync(path);
  try {
    const count = (table: string): number => {
      const row = raw.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
      return Number(row.count);
    };
    return {
      orders: count('orders'),
      audit: count('audit_events'),
      outbox: count('outbox_events'),
    };
  } finally {
    raw.close();
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('OperationsOnlineOrderAcceptanceService durable conversion', () => {
  it('converts PICKUP exactly once across duplicate Accept/retry and applies durable side effects once', async () => {
    const test = await fixture();

    const first = await test.acceptance.accept(onlineRequest(), pickupConfirmation());
    const retry = await test.acceptance.accept(onlineRequest(), pickupConfirmation());

    expect(first.ok).toBe(true);
    expect(retry.ok).toBe(true);
    if (!first.ok || !retry.ok) return;
    expect(first.value.order.id).toBe(RESERVED_ORDER_ID);
    expect(first.value.order.source).toBe('ONLINE');
    expect(first.value.order.idempotencyKey).toBe(REQUEST_ID);
    expect(first.value.order.businessDayId).toBe(DAY_ID);
    expect(first.value.order.operatorWorkerId).toBe(WORKER_ID);
    expect(first.value.order.displayOrderNo).toBe(1);
    expect(retry.value.order.id).toBe(RESERVED_ORDER_ID);
    expect(retry.value.replayed).toBe(true);

    const state = await test.database.transaction(async (transaction) => ({
      orders: await transaction.orders.listByBusinessDay(DAY_ID),
      day: await transaction.businessDays.getById(DAY_ID),
      movements: await transaction.inventory.listMovementsForOrder(RESERVED_ORDER_ID),
      outbox: await transaction.outbox.listPending(AT, 100),
    }));
    expect(state.orders).toHaveLength(1);
    expect(state.day?.lastAllocatedDisplayOrderNo).toBe(1);
    expect(state.movements).toHaveLength(1);
    expect(state.movements[0]?.movementType).toBe('ORDER_CONSUMPTION');
    expect(state.outbox.filter((event) => event.eventType === 'ORDER_PLACED')).toHaveLength(1);

    await closeFixture(test);
    expect(rawCounts(test.path)).toEqual({ orders: 1, audit: 1, outbox: 1 });
  });

  it('converts DELIVERY through current worker, zone, final fee, and payment authority', async () => {
    const test = await fixture();
    const result = await test.acceptance.accept(onlineRequest('DELIVERY'), deliveryConfirmation());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.order.id).toBe(RESERVED_ORDER_ID);
    expect(result.value.order.source).toBe('ONLINE');
    expect(result.value.order.fulfillment.behavior).toBe('DELIVERY');
    expect(result.value.order.deliveryFeeMinor).toBe(moneyMinor(2_500));
    expect(result.value.order.totalMinor).toBe(moneyMinor(21_500));
    expect(result.value.order.operatorWorkerId).toBe(WORKER_ID);

    await closeFixture(test);
  });

  it('rejects first conversion when no current worker exists and persists nothing', async () => {
    const test = await fixture({ openWorker: false });

    const result = await test.acceptance.accept(onlineRequest(), pickupConfirmation());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/operator|worker|session/i);
    const orders = await test.database.transaction((transaction) =>
      transaction.orders.listByBusinessDay(DAY_ID),
    );
    expect(orders).toHaveLength(0);

    await closeFixture(test);
    expect(rawCounts(test.path)).toEqual({ orders: 0, audit: 0, outbox: 0 });
  });

  it('rejects first conversion when the Business Day is closed and persists nothing', async () => {
    const test = await fixture();
    await test.database.transaction((transaction) =>
      transaction.businessDays.put({
        id: DAY_ID,
        shopId: SHOP_ID,
        status: 'CLOSED',
        startedAt: AT,
        endedAt: instant('2026-09-08T16:01:00.000Z'),
        startedByWorkerId: WORKER_ID,
        endedByWorkerId: WORKER_ID,
        lastAllocatedDisplayOrderNo: 0,
      }),
    );

    const result = await test.acceptance.accept(onlineRequest(), pickupConfirmation());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/business day|open/i);
    await closeFixture(test);
    expect(rawCounts(test.path)).toEqual({ orders: 0, audit: 0, outbox: 0 });
  });

  it('rolls back order, inventory, audit, and outbox when the durable placement transaction fails', async () => {
    const test = await fixture({ failingAudit: true });
    const result = await test.acceptance.accept(onlineRequest(), pickupConfirmation());

    expect(result.ok).toBe(false);
    const state = await test.database.transaction(async (transaction) => ({
      orders: await transaction.orders.listByBusinessDay(DAY_ID),
      movements: await transaction.inventory.listMovementsForOrder(RESERVED_ORDER_ID),
      day: await transaction.businessDays.getById(DAY_ID),
      outbox: await transaction.outbox.listPending(AT, 100),
    }));
    expect(state.orders).toHaveLength(0);
    expect(state.movements).toHaveLength(0);
    expect(state.day?.lastAllocatedDisplayOrderNo).toBe(0);
    expect(state.outbox).toHaveLength(0);

    await closeFixture(test);
    expect(rawCounts(test.path)).toEqual({ orders: 0, audit: 0, outbox: 0 });
  });
});
