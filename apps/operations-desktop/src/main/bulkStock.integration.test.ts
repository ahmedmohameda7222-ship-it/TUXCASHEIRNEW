import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { OperationsBulkStockService } from '@tux/application';
import {
  closeBusinessDay,
  createOpenBusinessDay,
  instant,
  parseEntityId,
  wholeStockUnits,
  type BusinessDayId,
  type InventoryItemId,
  type InventoryMovement,
  type InventoryMovementId,
  type OutboxEventId,
  type ShopId,
  type WorkerId,
  type WorkerSessionId,
} from '@tux/domain';
import {
  SqliteBulkStockStore,
  SqliteOperationsDatabase,
  SqliteOperatorSessionReadModel,
} from '@tux/persistence/sqlite';
import { afterEach, describe, expect, it } from 'vitest';

const SHOP_ID = parseEntityId<ShopId>('13000000-0000-4000-8000-000000000001');
const WORKER_ID = parseEntityId<WorkerId>('23000000-0000-4000-8000-000000000001');
const SESSION_ID = parseEntityId<WorkerSessionId>('33000000-0000-4000-8000-000000000001');
const DAY_ID = parseEntityId<BusinessDayId>('43000000-0000-4000-8000-000000000001');
const OLD_DAY_ID = parseEntityId<BusinessDayId>('43000000-0000-4000-8000-000000000002');
const BULK_ITEM_ID = parseEntityId<InventoryItemId>('53000000-0000-4000-8000-000000000001');
const RECIPE_ITEM_ID = parseEntityId<InventoryItemId>('53000000-0000-4000-8000-000000000002');
const STARTED_AT = instant('2026-08-18T13:00:00.000Z');
const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

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

function movement(input: {
  readonly id: string;
  readonly dayId: BusinessDayId;
  readonly type: InventoryMovement['movementType'];
  readonly units: number;
  readonly createdAt: string;
}): InventoryMovement {
  const id = parseEntityId<InventoryMovementId>(input.id);
  return {
    id,
    shopId: SHOP_ID,
    businessDayId: input.dayId,
    itemId: BULK_ITEM_ID,
    movementType: input.type,
    quantityDeltaMicros: wholeStockUnits(input.units),
    idempotencyKey: `fixture:${id}`,
    workerId: WORKER_ID,
    orderId: null,
    createdAt: instant(input.createdAt),
    compensatesMovementId: null,
  };
}

async function fixture(uuidSequence: string[] = []) {
  const directory = await mkdtemp(path.join(tmpdir(), 'tux-bulk-stock-'));
  const databasePath = path.join(directory, 'operations.sqlite3');
  const database = new SqliteOperationsDatabase(databasePath);
  await database.initialize();
  const store = new SqliteBulkStockStore(databasePath);
  await store.initialize();
  const readModel = new SqliteOperatorSessionReadModel(databasePath);

  const oldDay = closeBusinessDay(
    createOpenBusinessDay({
      id: OLD_DAY_ID,
      shopId: SHOP_ID,
      startedAt: instant('2026-08-17T13:00:00.000Z'),
      startedByWorkerId: WORKER_ID,
    }),
    instant('2026-08-18T02:00:00.000Z'),
    WORKER_ID,
  );
  const currentDay = createOpenBusinessDay({
    id: DAY_ID,
    shopId: SHOP_ID,
    startedAt: STARTED_AT,
    startedByWorkerId: WORKER_ID,
  });

  await database.transaction(async (transaction) => {
    await transaction.shops.put({ id: SHOP_ID, name: 'TUX Test Shop', active: true });
    await transaction.workers.put({
      id: WORKER_ID,
      shopId: SHOP_ID,
      displayName: 'Ahmed',
      pinHash: 'fixture-only',
      active: true,
    });
    await transaction.businessDays.put(oldDay);
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
      id: BULK_ITEM_ID,
      shopId: SHOP_ID,
      name: 'Fries Bags',
      unitLabel: 'bags',
      trackingMode: 'BULK_MANUAL',
      active: true,
    });
    await transaction.inventory.putItem({
      id: RECIPE_ITEM_ID,
      shopId: SHOP_ID,
      name: 'Beef',
      unitLabel: 'g',
      trackingMode: 'RECIPE_TRACKED',
      active: true,
    });
    await transaction.inventory.appendMovement(
      movement({
        id: '63000000-0000-4000-8000-000000000001',
        dayId: OLD_DAY_ID,
        type: 'BULK_STOCK_RECEIVED',
        units: 7,
        createdAt: '2026-08-17T14:00:00.000Z',
      }),
    );
    await transaction.inventory.appendMovement(
      movement({
        id: '63000000-0000-4000-8000-000000000002',
        dayId: OLD_DAY_ID,
        type: 'BULK_UNIT_FINISHED',
        units: -2,
        createdAt: '2026-08-17T22:00:00.000Z',
      }),
    );
  });

  let now = instant('2026-08-18T14:00:00.000Z');
  const ids = [...uuidSequence];
  const service = new OperationsBulkStockService(database, readModel, store, {
    now: () => now,
    createUuid: () => ids.shift() ?? randomUUID(),
  });

  cleanup.push(async () => {
    await readModel.close();
    await store.close();
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

describe('Operations Bulk Stock SQLite integration', () => {
  it('loads active BULK_MANUAL items and carries ledger balance across Business Days', async () => {
    const fx = await fixture();
    const result = await fx.service.loadBoard();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.businessDayId).toBe(DAY_ID);
    expect(result.value.items).toEqual([
      expect.objectContaining({ id: BULK_ITEM_ID, name: 'Fries Bags', currentWholeUnits: 5 }),
    ]);
  });

  it('commits Finished 1 and Add Stock as movement + audit + outbox without financial mutation', async () => {
    const fx = await fixture();
    const finishCommand = '73000000-0000-4000-8000-000000000001';
    const addCommand = '73000000-0000-4000-8000-000000000002';

    const finished = await fx.service.finishOne({ itemId: BULK_ITEM_ID, commandId: finishCommand });
    expect(finished.ok).toBe(true);
    fx.setNow('2026-08-18T14:00:01.000Z');
    const added = await fx.service.addStock({
      itemId: BULK_ITEM_ID,
      units: 3,
      commandId: addCommand,
    });
    expect(added.ok).toBe(true);

    const board = await fx.service.loadBoard();
    expect(board.ok).toBe(true);
    if (!board.ok) return;
    expect(board.value.items[0]?.currentWholeUnits).toBe(7);
    expect(
      sqlRows(
        fx.databasePath,
        'SELECT movement_type FROM inventory_movements WHERE business_day_id = ? ORDER BY created_at ASC',
        DAY_ID,
      ).map((row) => row['movement_type']),
    ).toEqual(['BULK_UNIT_FINISHED', 'BULK_STOCK_RECEIVED']);
    expect(
      sqlRows(
        fx.databasePath,
        "SELECT id FROM audit_events WHERE event_type = 'INVENTORY_MOVEMENT_RECORDED' AND business_day_id = ?",
        DAY_ID,
      ),
    ).toHaveLength(2);
    expect(
      sqlRows(
        fx.databasePath,
        "SELECT id FROM outbox_events WHERE event_type = 'INVENTORY_MOVEMENT_RECORDED' AND business_day_id = ?",
        DAY_ID,
      ),
    ).toHaveLength(2);
    expect(
      sqlRows(fx.databasePath, 'SELECT id FROM expenses WHERE business_day_id = ?', DAY_ID),
    ).toHaveLength(0);
  });

  it('makes movement commands idempotent by stable command UUID', async () => {
    const fx = await fixture();
    const commandId = '73000000-0000-4000-8000-000000000003';
    const first = await fx.service.addStock({ itemId: BULK_ITEM_ID, units: 4, commandId });
    const replay = await fx.service.addStock({ itemId: BULK_ITEM_ID, units: 4, commandId });
    expect(first.ok).toBe(true);
    expect(replay.ok).toBe(true);
    expect(
      sqlRows(fx.databasePath, 'SELECT id FROM inventory_movements WHERE id = ?', commandId),
    ).toHaveLength(1);
  });

  it('uses a compensating movement for short Undo and rejects a second or late Undo', async () => {
    const fx = await fixture();
    const originalId = '73000000-0000-4000-8000-000000000004';
    const undoId = '73000000-0000-4000-8000-000000000005';
    const created = await fx.service.addStock({
      itemId: BULK_ITEM_ID,
      units: 5,
      commandId: originalId,
    });
    expect(created.ok).toBe(true);
    fx.setNow('2026-08-18T14:00:07.000Z');
    const undone = await fx.service.undoMovement({
      movementId: parseEntityId<InventoryMovementId>(originalId),
      commandId: undoId,
    });
    expect(undone.ok).toBe(true);
    expect(
      sqlRows(
        fx.databasePath,
        'SELECT movement_type, quantity_delta_micros, compensates_movement_id FROM inventory_movements WHERE id = ?',
        undoId,
      )[0],
    ).toMatchObject({
      movement_type: 'UNDO_BULK_STOCK_RECEIVED',
      quantity_delta_micros: wholeStockUnits(-5),
      compensates_movement_id: originalId,
    });
    const secondUndo = await fx.service.undoMovement({
      movementId: parseEntityId<InventoryMovementId>(originalId),
      commandId: '73000000-0000-4000-8000-000000000006',
    });
    expect(secondUndo.ok).toBe(false);

    fx.setNow('2026-08-18T14:01:00.000Z');
    const lateOriginal = '73000000-0000-4000-8000-000000000007';
    fx.setNow('2026-08-18T14:01:00.000Z');
    expect((await fx.service.finishOne({ itemId: BULK_ITEM_ID, commandId: lateOriginal })).ok).toBe(
      true,
    );
    fx.setNow('2026-08-18T14:01:08.001Z');
    const lateUndo = await fx.service.undoMovement({
      movementId: parseEntityId<InventoryMovementId>(lateOriginal),
      commandId: '73000000-0000-4000-8000-000000000008',
    });
    expect(lateUndo.ok).toBe(false);
  });

  it('rolls back movement and audit when outbox persistence fails', async () => {
    const conflictingOutboxId = parseEntityId<OutboxEventId>(
      '83000000-0000-4000-8000-000000000002',
    );
    const fx = await fixture(['83000000-0000-4000-8000-000000000001', conflictingOutboxId]);
    await fx.database.transaction((transaction) =>
      transaction.outbox.append({
        id: conflictingOutboxId,
        shopId: SHOP_ID,
        businessDayId: DAY_ID,
        aggregateType: 'TEST',
        aggregateId: 'seed',
        eventType: 'SEED',
        idempotencyKey: 'seed:bulk-stock-failure',
        payloadVersion: 1,
        payload: { seeded: true },
        createdAt: STARTED_AT,
        attemptCount: 0,
        nextAttemptAt: null,
        lastError: null,
        deliveredAt: null,
      }),
    );

    const commandId = '73000000-0000-4000-8000-000000000009';
    const result = await fx.service.addStock({ itemId: BULK_ITEM_ID, units: 2, commandId });
    expect(result.ok).toBe(false);
    expect(
      sqlRows(fx.databasePath, 'SELECT id FROM inventory_movements WHERE id = ?', commandId),
    ).toHaveLength(0);
    expect(
      sqlRows(
        fx.databasePath,
        "SELECT id FROM audit_events WHERE aggregate_id = ? AND event_type = 'INVENTORY_MOVEMENT_RECORDED'",
        BULK_ITEM_ID,
      ),
    ).toHaveLength(0);
  });
});
