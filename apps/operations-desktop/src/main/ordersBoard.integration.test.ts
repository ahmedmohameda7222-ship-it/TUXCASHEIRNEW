import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { OperationsOrdersBoardService } from '@tux/application';
import {
  closeBusinessDay,
  createOpenBusinessDay,
  instant,
  moneyMinor,
  orderLifecycle,
  parseEntityId,
  stockQuantityMicros,
  type BusinessDayId,
  type DeliveryZoneId,
  type InventoryItemId,
  type InventoryMovementId,
  type OrderId,
  type OrderItemId,
  type OrderSnapshot,
  type OrderTypeId,
  type PaymentId,
  type PaymentMethodId,
  type ProductId,
  type ShopId,
  type WorkerId,
  type WorkerSessionId,
} from '@tux/domain';
import { SqliteOperationsDatabase, SqliteOperatorSessionReadModel } from '@tux/persistence/sqlite';
import { afterEach, describe, expect, it } from 'vitest';

const SHOP_ID = parseEntityId<ShopId>('11000000-0000-4000-8000-000000000001');
const WORKER_ID = parseEntityId<WorkerId>('21000000-0000-4000-8000-000000000001');
const SESSION_ID = parseEntityId<WorkerSessionId>('31000000-0000-4000-8000-000000000001');
const DAY_ID = parseEntityId<BusinessDayId>('41000000-0000-4000-8000-000000000001');
const CLOSED_DAY_ID = parseEntityId<BusinessDayId>('41000000-0000-4000-8000-000000000002');
const INVENTORY_ID = parseEntityId<InventoryItemId>('71000000-0000-4000-8000-000000000001');
const ORDER_TYPE_ID = parseEntityId<OrderTypeId>('81000000-0000-4000-8000-000000000001');
const DELIVERY_TYPE_ID = parseEntityId<OrderTypeId>('81000000-0000-4000-8000-000000000002');
const PAYMENT_METHOD_ID = parseEntityId<PaymentMethodId>('91000000-0000-4000-8000-000000000001');
const PRODUCT_ID = parseEntityId<ProductId>('61000000-0000-4000-8000-000000000001');
const ZONE_ID = parseEntityId<DeliveryZoneId>('a1000000-0000-4000-8000-000000000001');
const STARTED_AT = instant('2026-08-18T13:00:00.000Z');
const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

function order(input: {
  id: string;
  no: number;
  status?: OrderSnapshot['status'];
  businessDayId?: BusinessDayId;
  delivery?: boolean;
  createdAt?: string;
}): OrderSnapshot {
  const orderId = parseEntityId<OrderId>(input.id);
  const delivery = input.delivery ?? false;
  const status = input.status ?? 'ACTIVE';
  return {
    id: orderId,
    shopId: SHOP_ID,
    businessDayId: input.businessDayId ?? DAY_ID,
    displayOrderNo: input.no,
    idempotencyKey: `checkout-${orderId}`,
    status,
    lifecycle: {
      revision: status === 'DONE' ? 1 : 0,
      doneAt: status === 'DONE' ? instant('2026-08-18T14:00:00.000Z') : null,
      cancellation: null,
      returned: null,
    },
    source: 'POS',
    operatorWorkerId: WORKER_ID,
    operatorName: 'Ahmed',
    createdAt: instant(
      input.createdAt ?? `2026-08-18T13:${String(input.no).padStart(2, '0')}:00.000Z`,
    ),
    fulfillment: delivery
      ? {
          orderTypeId: DELIVERY_TYPE_ID,
          orderTypeLabel: 'Delivery',
          behavior: 'DELIVERY',
          delivery: {
            customerContactId: null,
            customerName: 'Mona',
            normalizedPhone: '01000000000',
            address: 'Nasr City, Cairo',
            zoneId: ZONE_ID,
            zoneLabel: 'Nasr City',
            configuredFeeMinor: moneyMinor(2_000),
            finalFeeMinor: moneyMinor(2_000),
          },
        }
      : {
          orderTypeId: ORDER_TYPE_ID,
          orderTypeLabel: 'Take Away',
          behavior: 'TAKE_AWAY',
          delivery: null,
        },
    items: [
      {
        id: parseEntityId<OrderItemId>(randomUUID()),
        productId: PRODUCT_ID,
        productName: 'Burger',
        unitPriceMinor: moneyMinor(10_000),
        quantity: 1,
        modifiers: [],
        comboBeverages: [],
        itemNote: null,
      },
    ],
    orderNote: null,
    itemsSubtotalMinor: moneyMinor(10_000),
    discountMinor: moneyMinor(0),
    deliveryFeeMinor: delivery ? moneyMinor(2_000) : moneyMinor(0),
    totalMinor: delivery ? moneyMinor(12_000) : moneyMinor(10_000),
    payments: [
      {
        id: parseEntityId<PaymentId>(randomUUID()),
        method: { id: PAYMENT_METHOD_ID, label: 'Instapay', logicType: 'DIGITAL' },
        allocatedMinor: delivery ? moneyMinor(12_000) : moneyMinor(10_000),
        receivedMinor: null,
        changeMinor: null,
      },
    ],
  };
}

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'tux-orders-board-'));
  const databasePath = path.join(directory, 'operations.sqlite3');
  const database = new SqliteOperationsDatabase(databasePath);
  await database.initialize();

  const currentDay = createOpenBusinessDay({
    id: DAY_ID,
    shopId: SHOP_ID,
    startedAt: STARTED_AT,
    startedByWorkerId: WORKER_ID,
  });
  const oldOpen = createOpenBusinessDay({
    id: CLOSED_DAY_ID,
    shopId: SHOP_ID,
    startedAt: instant('2026-08-17T13:00:00.000Z'),
    startedByWorkerId: WORKER_ID,
  });
  const closedDay = closeBusinessDay(oldOpen, instant('2026-08-18T02:00:00.000Z'), WORKER_ID);

  await database.transaction(async (transaction) => {
    await transaction.shops.put({ id: SHOP_ID, name: 'TUX Test Shop', active: true });
    await transaction.workers.put({
      id: WORKER_ID,
      shopId: SHOP_ID,
      displayName: 'Ahmed',
      pinHash: 'fixture-only',
      active: true,
    });
    await transaction.businessDays.put(closedDay);
    await transaction.businessDays.put(currentDay);
    await transaction.workerSessions.put({
      id: SESSION_ID,
      shopId: SHOP_ID,
      businessDayId: DAY_ID,
      workerId: WORKER_ID,
      startedAt: STARTED_AT,
      endedAt: null,
    });
    await transaction.inventory.putItem({
      id: INVENTORY_ID,
      shopId: SHOP_ID,
      name: 'Beef',
      unitLabel: 'g',
      trackingMode: 'RECIPE_TRACKED',
      active: true,
    });
  });

  const readModel = new SqliteOperatorSessionReadModel(databasePath);
  let now = instant('2026-08-18T14:05:00.000Z');
  const service = new OperationsOrdersBoardService(database, readModel, {
    now: () => now,
    createUuid: () => randomUUID(),
  });

  cleanup.push(async () => {
    await readModel.close();
    await database.close();
    await rm(directory, { recursive: true, force: true });
  });

  return {
    database,
    databasePath,
    service,
    setNow(value: string) {
      now = instant(value);
    },
  };
}

async function insertOrder(
  database: SqliteOperationsDatabase,
  value: OrderSnapshot,
  withConsumption = false,
): Promise<InventoryMovementId | null> {
  let movementId: InventoryMovementId | null = null;
  await database.transaction(async (transaction) => {
    await transaction.orders.insert(value);
    if (withConsumption) {
      movementId = parseEntityId<InventoryMovementId>(randomUUID());
      await transaction.inventory.appendMovement({
        id: movementId,
        shopId: value.shopId,
        businessDayId: value.businessDayId,
        itemId: INVENTORY_ID,
        movementType: 'ORDER_CONSUMPTION',
        quantityDeltaMicros: stockQuantityMicros(-500_000),
        idempotencyKey: `order-consumption:${value.id}:${INVENTORY_ID}`,
        workerId: WORKER_ID,
        orderId: value.id,
        createdAt: value.createdAt,
        compensatesMovementId: null,
      });
    }
  });
  return movementId;
}

function sqlRows(
  databasePath: string,
  sql: string,
  ...params: string[]
): Record<string, unknown>[] {
  const raw = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return raw.prepare(sql).all(...params) as Record<string, unknown>[];
  } finally {
    raw.close();
  }
}

describe('Operations Orders Board SQLite integration', () => {
  it('loads only the current open Business Day, independent of calendar date', async () => {
    const fx = await fixture();
    const current = order({ id: 'c1000000-0000-4000-8000-000000000001', no: 1 });
    const historical = order({
      id: 'c1000000-0000-4000-8000-000000000002',
      no: 1,
      businessDayId: CLOSED_DAY_ID,
      createdAt: '2026-08-17T20:00:00.000Z',
    });
    await insertOrder(fx.database, historical);
    await insertOrder(fx.database, current);

    const result = await fx.service.loadBoard();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.businessDayId).toBe(DAY_ID);
    expect(result.value.orders.map((candidate) => candidate.id)).toEqual([current.id]);
  });

  it('marks Done and undoes within the short window without inventory or payment mutation', async () => {
    const fx = await fixture();
    const original = order({ id: 'c2000000-0000-4000-8000-000000000001', no: 2 });
    await insertOrder(fx.database, original, true);
    const beforePayments = JSON.stringify(original.payments);

    fx.setNow('2026-08-18T14:05:00.000Z');
    const done = await fx.service.markDone(original.id);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.value.status).toBe('DONE');
    expect(JSON.stringify(done.value.payments)).toBe(beforePayments);

    fx.setNow('2026-08-18T14:05:07.000Z');
    const undone = await fx.service.undoDone(original.id);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(undone.value.status).toBe('ACTIVE');
    expect(JSON.stringify(undone.value.payments)).toBe(beforePayments);

    const movements = await fx.database.transaction((transaction) =>
      transaction.inventory.listMovementsForOrder(original.id),
    );
    expect(movements).toHaveLength(1);
    expect(
      sqlRows(
        fx.databasePath,
        'SELECT event_type FROM audit_events WHERE aggregate_id = ? ORDER BY created_at',
        original.id,
      ).map((row) => row['event_type']),
    ).toEqual(['ORDER_MARKED_DONE', 'ORDER_DONE_UNDONE']);
    expect(
      sqlRows(
        fx.databasePath,
        'SELECT event_type FROM outbox_events WHERE aggregate_id = ? ORDER BY created_at',
        original.id,
      ),
    ).toHaveLength(2);
  });

  it('rejects Done undo after the approved window without an extra mutation', async () => {
    const fx = await fixture();
    const original = order({ id: 'c3000000-0000-4000-8000-000000000001', no: 3 });
    await insertOrder(fx.database, original);
    fx.setNow('2026-08-18T14:05:00.000Z');
    const done = await fx.service.markDone(original.id);
    expect(done.ok).toBe(true);
    fx.setNow('2026-08-18T14:05:08.001Z');
    const late = await fx.service.undoDone(original.id);
    expect(late.ok).toBe(false);
    if (late.ok) return;
    expect(late.error.code).toBe('CONFLICT_ERROR');
    const saved = await fx.database.transaction((transaction) =>
      transaction.orders.getById(original.id),
    );
    expect(saved?.status).toBe('DONE');
    expect(
      sqlRows(fx.databasePath, 'SELECT id FROM audit_events WHERE aggregate_id = ?', original.id),
    ).toHaveLength(1);
  });

  it('cancels ACTIVE not-prepared order with exact compensating restock and immutable financial facts', async () => {
    const fx = await fixture();
    const original = order({ id: 'c4000000-0000-4000-8000-000000000001', no: 4 });
    const originalMovementId = await insertOrder(fx.database, original, true);
    const result = await fx.service.cancelOrder({
      orderId: original.id,
      foodPrepared: false,
      reason: 'Customer cancelled',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('CANCELLED');
    expect(result.value.totalMinor).toBe(original.totalMinor);
    expect(result.value.payments).toEqual(original.payments);
    expect(orderLifecycle(result.value).cancellation).toMatchObject({
      foodPrepared: false,
      stockRestored: true,
      reason: 'Customer cancelled',
    });

    const movements = await fx.database.transaction((transaction) =>
      transaction.inventory.listMovementsForOrder(original.id),
    );
    expect(movements).toHaveLength(2);
    const restock = movements.find((movement) => movement.movementType === 'CANCEL_RESTOCK');
    expect(restock?.quantityDeltaMicros).toBe(stockQuantityMicros(500_000));
    expect(restock?.compensatesMovementId).toBe(originalMovementId);
    expect(
      sqlRows(
        fx.databasePath,
        'SELECT event_type FROM audit_events WHERE aggregate_id = ?',
        original.id,
      ).map((row) => row['event_type']),
    ).toEqual(['ORDER_CANCELLED']);
    expect(
      sqlRows(
        fx.databasePath,
        'SELECT event_type FROM outbox_events WHERE aggregate_id = ?',
        original.id,
      ).map((row) => row['event_type']),
    ).toEqual(['ORDER_CANCELLED']);
  });

  it('cancels prepared order without restoring inventory', async () => {
    const fx = await fixture();
    const original = order({ id: 'c5000000-0000-4000-8000-000000000001', no: 5 });
    await insertOrder(fx.database, original, true);
    const result = await fx.service.cancelOrder({
      orderId: original.id,
      foodPrepared: true,
      reason: 'Duplicate ticket',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(orderLifecycle(result.value).cancellation?.stockRestored).toBe(false);
    const movements = await fx.database.transaction((transaction) =>
      transaction.inventory.listMovementsForOrder(original.id),
    );
    expect(movements).toHaveLength(1);
  });

  it('records DONE Delivery as RETURNED with null-amount Delivery Failed expense and no stock restore', async () => {
    const fx = await fixture();
    const original = order({
      id: 'c6000000-0000-4000-8000-000000000001',
      no: 6,
      status: 'DONE',
      delivery: true,
    });
    await insertOrder(fx.database, original, true);
    const result = await fx.service.returnDelivery({
      orderId: original.id,
      reason: 'Customer did not receive order',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('RETURNED');
    expect(result.value.totalMinor).toBe(original.totalMinor);
    expect(result.value.payments).toEqual(original.payments);

    const movements = await fx.database.transaction((transaction) =>
      transaction.inventory.listMovementsForOrder(original.id),
    );
    expect(movements).toHaveLength(1);
    const expenses = sqlRows(
      fx.databasePath,
      'SELECT kind, amount_minor, paid_from, order_id, payload_json FROM expenses WHERE order_id = ?',
      original.id,
    );
    expect(expenses).toHaveLength(1);
    expect(expenses[0]?.['kind']).toBe('DELIVERY_FAILED');
    expect(expenses[0]?.['amount_minor']).toBeNull();
    expect(expenses[0]?.['paid_from']).toBeNull();
    const payload = JSON.parse(String(expenses[0]?.['payload_json'])) as {
      amountMinor: unknown;
      orderId: unknown;
    };
    expect(payload.amountMinor).toBeNull();
    expect(payload.orderId).toBe(original.id);
    expect(
      sqlRows(
        fx.databasePath,
        'SELECT event_type FROM audit_events WHERE aggregate_id = ?',
        original.id,
      ).map((row) => row['event_type']),
    ).toEqual(['DELIVERY_RETURNED']);
    expect(
      sqlRows(
        fx.databasePath,
        'SELECT event_type FROM outbox_events WHERE aggregate_id = ?',
        original.id,
      ).map((row) => row['event_type']),
    ).toEqual(['DELIVERY_RETURNED']);
  });

  it('rejects terminal/invalid transitions without additional side effects', async () => {
    const fx = await fixture();
    const doneTakeAway = order({
      id: 'c7000000-0000-4000-8000-000000000001',
      no: 7,
      status: 'DONE',
    });
    await insertOrder(fx.database, doneTakeAway);
    const returned = await fx.service.returnDelivery({
      orderId: doneTakeAway.id,
      reason: 'Not a delivery',
    });
    expect(returned.ok).toBe(false);
    const cancel = await fx.service.cancelOrder({
      orderId: doneTakeAway.id,
      foodPrepared: false,
      reason: 'Too late',
    });
    expect(cancel.ok).toBe(false);
    expect(
      sqlRows(
        fx.databasePath,
        'SELECT id FROM audit_events WHERE aggregate_id = ?',
        doneTakeAway.id,
      ),
    ).toHaveLength(0);
    expect(
      sqlRows(
        fx.databasePath,
        'SELECT id FROM outbox_events WHERE aggregate_id = ?',
        doneTakeAway.id,
      ),
    ).toHaveLength(0);
    expect(
      sqlRows(fx.databasePath, 'SELECT id FROM expenses WHERE order_id = ?', doneTakeAway.id),
    ).toHaveLength(0);
  });
});
